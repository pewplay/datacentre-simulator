/*
 * Datacentre Simulator
 * Originally created by Alan Reed & Mike Smith for js13kGames 2018 (MIT licence).
 * Rebuilt for PewPlay as a single readable script: no build step, no modules,
 * responsive canvas, pointer/touch controls.
 *
 * You keep an old, unreliable datacentre online. When a region fails you go
 * inside and place patch cables that bounce data packets into connections
 * before they time out.
 */
(function () {
  'use strict';

  var SLUG = 'datacentre-simulator';
  var COMPANY = 'Rickety Cloud Co.';
  var STEP = 1000 / 60; // fixed simulation step (the original ran at 60 updates per second)

  var COLORS = {
    outside: '#00151c',
    field: '#012A36',
    grid: 'rgba(160, 220, 230, 0.045)',
    text: '#E5DADA',
    dim: '#8fa8b3',
    cable: '#E59500',
    cursor: '#ffae19',
    packet: '#34D1BF',
    packetEdge: '#249e90',
    region: 'rgba(251, 86, 7, 0.5)',
    ok: '#00E52D',
    bad: '#ff2a3d'
  };

  var FONT = 'Helvetica, Arial, sans-serif';

  // ---------------------------------------------------------------------------
  // Storage (all keys prefixed with the slug)
  // ---------------------------------------------------------------------------
  function loadNumber(key) {
    try {
      var v = parseFloat(localStorage.getItem(SLUG + ':' + key));
      return isFinite(v) ? v : 0;
    } catch (e) {
      return 0;
    }
  }
  function saveNumber(key, value) {
    try {
      localStorage.setItem(SLUG + ':' + key, String(value));
    } catch (e) { /* storage unavailable: ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Canvas, scaling and field size
  // ---------------------------------------------------------------------------
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var screenW = 0;
  var screenH = 0;
  var dpr = 1;
  var view = { scale: 1, ox: 0, oy: 0 };

  // The play field keeps a fixed number of units on its short side (500, like
  // the original 500x500 canvas; 420 on small screens such as phones so that
  // everything is drawn bigger) and stretches the long side to follow the
  // screen shape, within limits. Anything beyond that is letterboxed.
  function idealFieldSize() {
    var sw = screenW || 500, sh = screenH || 500;
    var short = Math.min(sw, sh) < 600 ? 420 : 500;
    var a = clamp(sw / sh, 0.45, 2.2);
    if (a >= 1) return { w: Math.round(short * a), h: short };
    return { w: short, h: Math.round(short / a) };
  }

  function resize() {
    screenW = Math.max(1, window.innerWidth || document.documentElement.clientWidth);
    screenH = Math.max(1, window.innerHeight || document.documentElement.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(screenW * dpr);
    canvas.height = Math.round(screenH * dpr);
    if (scene && scene.relayout) scene.relayout();
    updateView();
  }

  function updateView() {
    if (!scene) return;
    var s = Math.min(screenW / scene.w, screenH / scene.h);
    view.scale = s;
    view.ox = (screenW - scene.w * s) / 2;
    view.oy = (screenH - scene.h * s) / 2;
  }

  function toField(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - view.ox) / view.scale,
      y: (e.clientY - r.top - view.oy) / view.scale
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rand(min, max) { return min + Math.random() * (max - min); }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setFont(size, weight) {
    ctx.font = (weight || 'normal') + ' ' + size + 'px ' + FONT;
  }

  function text(str, x, y, size, color, align, weight) {
    setFont(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  function wrap(str, maxWidth, size, weight) {
    setFont(size, weight);
    var words = str.split(' ');
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Canvas button (hit area at least 56 field units tall = 40+ CSS px on a phone)
  function Button(label, primary) {
    this.label = label;
    this.primary = !!primary;
    this.x = 0; this.y = 0; this.w = 220; this.h = 60;
    this.hover = false;
  }
  Button.prototype.place = function (cx, cy, w, h) {
    this.w = w || this.w; this.h = h || this.h;
    this.x = cx - this.w / 2; this.y = cy - this.h / 2;
  };
  Button.prototype.hit = function (p) {
    return p.x >= this.x && p.x <= this.x + this.w && p.y >= this.y && p.y <= this.y + this.h;
  };
  Button.prototype.render = function () {
    roundRect(this.x, this.y, this.w, this.h, 10);
    ctx.fillStyle = this.primary ? (this.hover ? '#ffb733' : COLORS.cable) : (this.hover ? 'rgba(229,218,218,0.16)' : 'rgba(229,218,218,0.07)');
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.primary ? '#ffcf70' : 'rgba(229,218,218,0.5)';
    ctx.stroke();
    text(this.label, this.x + this.w / 2, this.y + this.h / 2 + 1, 26, this.primary ? '#012A36' : COLORS.text, 'center', 'bold');
  };

  // ---------------------------------------------------------------------------
  // Pixel-font title (replaces the original logo bitmap so it reads "DATACENTRE")
  // ---------------------------------------------------------------------------
  var GLYPHS = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110']
  };

  function pixelWordWidth(word, cell) {
    return (word.length * 6 - 1) * cell;
  }

  function drawPixelWord(word, cx, top, cell) {
    var x0 = cx - pixelWordWidth(word, cell) / 2;
    var skew = 0.18; // slight italic like the original logo
    var layers = [
      { dx: cell * 0.9, dy: cell * 0.9, color: '#062f3c', pad: 0.5 },
      { dx: cell * 0.45, dy: cell * 0.45, color: '#0b6b78', pad: 0.5 },
      { dx: 0, dy: 0, color: COLORS.packet, pad: 0.5 },
      { dx: 0, dy: 0, color: '#ffffff', pad: 0 }
    ];
    for (var l = 0; l < layers.length; l++) {
      var layer = layers[l];
      ctx.fillStyle = layer.color;
      for (var i = 0; i < word.length; i++) {
        var g = GLYPHS[word[i]];
        if (!g) continue;
        for (var row = 0; row < 7; row++) {
          for (var col = 0; col < 5; col++) {
            if (g[row][col] !== '1') continue;
            var px = x0 + (i * 6 + col) * cell + (6 - row) * cell * skew + layer.dx;
            var py = top + row * cell + layer.dy;
            var pad = layer.pad * cell * 0.5;
            ctx.fillRect(px - pad, py - pad, cell + pad * 2 + 0.6, cell + pad * 2 + 0.6);
          }
        }
      }
    }
  }

  function drawTitle(cx, top, maxWidth) {
    var cell = Math.min(8, maxWidth / 61);
    drawPixelWord('DATACENTRE', cx, top, cell);
    drawPixelWord('SIMULATOR', cx, top + cell * 9.5, cell);
    return cell * 16.5;
  }

  // ---------------------------------------------------------------------------
  // Game objects (ported from the original source)
  // ---------------------------------------------------------------------------

  // Patch cable: a thin rotated bar that packets bounce off.
  function Block(x, y, width, height, rotation) {
    this.x = x; this.y = y;
    this.width = width; this.height = height;
    this.rotation = rotation;
    this.color = COLORS.cable;
  }
  Block.prototype.render = function (alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
    // small connector plugs on both ends
    ctx.fillStyle = '#b06f00';
    ctx.fillRect(-this.width / 2 - 2, -this.height / 2 - 1, 5, this.height + 2);
    ctx.fillRect(this.width / 2 - 3, -this.height / 2 - 1, 5, this.height + 2);
    ctx.restore();
  };

  // Data packet: a small circle travelling in a straight line.
  function Packet(x, y, speed, rotation, radius, fieldW, fieldH) {
    this.x = x; this.y = y;
    this.dx = speed * Math.cos(rotation);
    this.dy = speed * Math.sin(rotation);
    this.radius = radius;
    this.fieldW = fieldW; this.fieldH = fieldH;
    this.lost = false;
  }
  Packet.prototype.update = function () {
    if (this.x < -this.radius * 3 || this.x > this.fieldW + this.radius * 3 ||
        this.y < -this.radius * 3 || this.y > this.fieldH + this.radius * 3) {
      this.lost = true;
    } else {
      this.x += this.dx;
      this.y += this.dy;
    }
  };
  // Circle vs. segment collision with a perfectly elastic reflection
  // (restitution 1, as in the original). Returns the contact point or null.
  Packet.prototype.checkBlockCollisions = function (blocks) {
    var hit = null;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var ux = Math.cos(b.rotation), uy = Math.sin(b.rotation);
      var half = b.width / 2;
      var rx = this.x - b.x, ry = this.y - b.y;
      var t = clamp(rx * ux + ry * uy, -half, half);
      var cx = b.x + ux * t, cy = b.y + uy * t;
      var nx = this.x - cx, ny = this.y - cy;
      var dist = Math.sqrt(nx * nx + ny * ny);
      var reach = this.radius + b.height / 2;
      if (dist < reach) {
        if (dist < 0.0001) { nx = -uy; ny = ux; dist = 1; } else { nx /= dist; ny /= dist; }
        var vn = this.dx * nx + this.dy * ny;
        if (vn < 0) {
          this.dx -= 2 * vn * nx;
          this.dy -= 2 * vn * ny;
          hit = { x: cx, y: cy };
        }
        // push the packet out so it never gets stuck inside a cable
        this.x = cx + nx * reach;
        this.y = cy + ny * reach;
      }
    }
    return hit;
  };
  Packet.prototype.render = function () {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.packet;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = COLORS.packetEdge;
    ctx.stroke();
  };

  // Emits packets from a fixed point on the edge of the field.
  function PacketSpawner(rate, fieldW, fieldH, speed) {
    this.rate = rate;
    this.speed = speed;
    this.fieldW = fieldW; this.fieldH = fieldH;
    this.packetWidth = 4;
    var pw = this.packetWidth;
    var side = Math.floor(Math.random() * 4);
    if (side === 0) { this.x = -pw; this.y = rand(pw * 10, fieldH - pw * 10); }
    else if (side === 1) { this.x = rand(pw * 10, fieldW - pw * 10); this.y = -pw; }
    else if (side === 2) { this.x = fieldW + pw; this.y = rand(pw * 10, fieldH - pw * 10); }
    else { this.x = rand(pw * 10, fieldW - pw * 10); this.y = fieldH + pw; }

    // Don't let packets leave less than 15 degrees from a side
    var minRotation = Math.PI / 12;
    if (this.x < fieldW / 2) {
      this.rotation = minRotation + Math.random() * (Math.PI / 2 - 2 * minRotation);
    } else {
      this.rotation = Math.PI / 2 + minRotation + Math.random() * (Math.PI / 2 - 2 * minRotation);
    }
    if (this.y > fieldH / 2) this.rotation *= -1;
  }
  PacketSpawner.prototype.checkSpawnPacket = function () {
    return Math.random() < this.rate;
  };
  PacketSpawner.prototype.generatePacket = function () {
    return new Packet(this.x, this.y, this.speed * (Math.random() + 1), this.rotation,
      this.packetWidth, this.fieldW, this.fieldH);
  };

  // Expanding ring shown where a packet bounces.
  function Effect(x, y, radius, lifetime) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.lifetime = lifetime;
    this.finished = false;
  }
  Effect.prototype.update = function () {
    if (this.lifetime > 0) { this.radius += 1; this.lifetime -= 1; } else { this.finished = true; }
  };
  Effect.prototype.render = function () {
    var g = ctx.createRadialGradient(this.x, this.y, this.radius / 2, this.x, this.y, this.radius);
    g.addColorStop(0, 'rgba(169,188,208,0)');
    g.addColorStop(0.2, '#A9BCD0');
    g.addColorStop(1, '#D8DBE2');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
  };

  // Connection: needs packets regularly, otherwise its ping climbs and it fails.
  var PING_GRADIENT = ['#00E52D', '#02E701', '#32E902', '#63EC03', '#95EE05', '#C7F006', '#F3EC07',
    '#F5BE09', '#F78F0A', '#FA600C', '#FC310D', '#FF0F1B'];

  function Connection(x, y, width, height, packetWaitTime, successWaitTime) {
    this.x = x; this.y = y;
    this.width = width; this.height = height;
    this.color = PING_GRADIENT[0];
    this.packetWaitTime = packetWaitTime;
    this.successWaitTime = successWaitTime;
    this.timeSinceLastPacket = 0;
    this.timeSpentOK = 0;
    this.failed = false;
    this.succeeded = false;
    this.pulse = 0;
  }
  Connection.prototype.checkCollisions = function (packets) {
    for (var i = 0; i < packets.length; i++) {
      var p = packets[i];
      if (p.lost) continue;
      var cx = clamp(p.x, this.x, this.x + this.width);
      var cy = clamp(p.y, this.y, this.y + this.height);
      var dx = p.x - cx, dy = p.y - cy;
      if (dx * dx + dy * dy < p.radius * p.radius) {
        this.timeSinceLastPacket = 0;
        this.pulse = 12;
        p.lost = true;
      }
    }
  };
  Connection.prototype.update = function () {
    var last = PING_GRADIENT.length - 1;
    var i = clamp(Math.round(last * (this.timeSinceLastPacket / this.packetWaitTime)), 0, last);
    if (i === last) {
      var flashPeriod = 30;
      this.color = (this.timeSinceLastPacket - this.packetWaitTime) % flashPeriod < flashPeriod / 2 ? '#000000' : PING_GRADIENT[i];
      this.timeSpentOK = 0;
      this.succeeded = false;
    } else {
      if (i < 1) {
        this.timeSpentOK++;
        if (this.timeSpentOK > this.successWaitTime) this.succeeded = true;
      } else {
        this.timeSpentOK = 0;
        this.succeeded = false;
      }
      this.color = PING_GRADIENT[i];
    }
    if (this.timeSinceLastPacket > 2 * this.packetWaitTime) this.failed = true;
    this.timeSinceLastPacket++;
    if (this.pulse > 0) this.pulse--;
  };
  Connection.prototype.render = function () {
    var cx = this.x + this.width / 2, cy = this.y + this.height / 2;
    // progress ring towards a stable link
    if (this.timeSpentOK > 0 || this.succeeded) {
      var frac = this.succeeded ? 1 : this.timeSpentOK / this.successWaitTime;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.succeeded ? COLORS.ok : 'rgba(0,229,45,0.55)';
      ctx.stroke();
    }
    if (this.pulse > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, 14 + (12 - this.pulse), 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(52,209,191,' + (this.pulse / 12) + ')';
      ctx.stroke();
    }
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(this.x + 5, this.y + 5, this.width - 10, this.height - 10);
  };

  // A region box on the overview screen.
  function DataCenterElement(name, shouldFail, failureDelay) {
    this.name = name;
    this.x = 0; this.y = 0; this.size = 80;
    this.isFailed = false;
    this.shouldFail = shouldFail;
    this.failureDelay = failureDelay;
    this.time = 0;
  }
  DataCenterElement.prototype.update = function () {
    this.time++;
    if (this.shouldFail && !this.isFailed) {
      this.failureDelay--;
      if (this.failureDelay <= 0) this.isFailed = true;
    }
  };
  DataCenterElement.prototype.hit = function (p) {
    var pad = 10;
    return p.x >= this.x - pad && p.x <= this.x + this.size + pad && p.y >= this.y - pad && p.y <= this.y + this.size + pad;
  };
  DataCenterElement.prototype.render = function () {
    var s = this.size;
    var flashOn = this.isFailed && Math.floor(this.time / 10) % 2 === 0;
    ctx.fillStyle = this.isFailed ? (flashOn ? '#d6111f' : '#3a0b10') : COLORS.region;
    ctx.fillRect(this.x, this.y, s, s);
    ctx.strokeStyle = '#272727';
    ctx.lineWidth = 10;
    ctx.strokeRect(this.x, this.y, s, s);
    // rack lights
    for (var i = 0; i < 4; i++) {
      var on = this.isFailed ? flashOn : ((this.time >> 3) + i * 7 + this.name.charCodeAt(0)) % 5 !== 0;
      ctx.fillStyle = this.isFailed ? (on ? '#ffd0d0' : '#5a1a1a') : (on ? '#7dffa0' : '#2f5a3a');
      ctx.fillRect(this.x + 12 + i * ((s - 30) / 3), this.y + s - 18, 6, 5);
    }
    text(this.name, this.x + s / 2, this.y + s / 2 - 5, 26, COLORS.text, 'center', 'bold');
  };

  // ---------------------------------------------------------------------------
  // Shared field drawing
  // ---------------------------------------------------------------------------
  function drawFieldBackground(w, h) {
    ctx.fillStyle = COLORS.field;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 50; x < w; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (var y = 50; y < h; y += 50) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  function isTouchUI() {
    return lastPointerType === 'touch' || lastPointerType === 'pen' ||
      (lastPointerType === '' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  // ---------------------------------------------------------------------------
  // Run state (one attempt from the first repair until the datacentre goes offline)
  // ---------------------------------------------------------------------------
  var run = { level: 0, frames: 0, started: false, repaired: 0 };

  function newRun() {
    run = { level: 0, frames: 0, started: false, repaired: 0 };
  }

  // ---------------------------------------------------------------------------
  // Scenes
  // ---------------------------------------------------------------------------
  var scene = null;

  function setScene(s) {
    scene = s;
    updateView();
  }

  // --- Menu: main, info and failed screens -----------------------------------
  function Menu(screen, result) {
    this.screen = screen;
    this.result = result || null;
    this.packets = [];
    this.effects = [];
    this.playBtn = new Button('Play', true);
    this.startBtn = new Button('Start Game', true);
    this.retryBtn = new Button('Try Again', true);
    this.menuBtn = new Button('Main Menu', false);
    this.time = 0;
    this.relayout();
  }
  Menu.prototype.relayout = function () {
    var f = idealFieldSize();
    this.w = f.w; this.h = f.h;
    var w = this.w, h = this.h;
    this.playBtn.place(w / 2, h - 70, 220, 64);
    this.startBtn.place(w / 2, h - 52, 250, 60);
    if (w >= 560) {
      this.retryBtn.place(w / 2 - 130, h - 70, 230, 62);
      this.menuBtn.place(w / 2 + 130, h - 70, 230, 62);
    } else {
      this.retryBtn.place(w / 2, h - 148, 260, 60);
      this.menuBtn.place(w / 2, h - 70, 260, 60);
    }
    // demo on the title screen: two packet streams bouncing off one vertical cable
    var titleBottom = Math.max(40, h * 0.12) + 16.5 * Math.min(8, Math.min(w - 50, 470) / 61) + 50;
    var cy = (titleBottom + this.playBtn.y) / 2;
    this.demoBlocks = [new Block(w / 2, cy, 60, 5, Math.PI / 2)];
    var y0 = cy - Math.tan(Math.PI / 8) * (w / 2);
    var left = new PacketSpawner(0.05, w, h, 2);
    var right = new PacketSpawner(0.05, w, h, 2);
    left.x = -left.packetWidth; left.y = y0; left.rotation = Math.PI / 8;
    right.x = w + right.packetWidth; right.y = y0; right.rotation = 7 * Math.PI / 8;
    this.spawners = [left, right];
    this.packets = [];
    this.effects = [];
  };
  Menu.prototype.update = function () {
    this.time++;
    if (this.screen !== 'main') return;
    var self = this;
    this.spawners.forEach(function (sp) {
      if (sp.checkSpawnPacket()) self.packets.push(sp.generatePacket());
    });
    this.packets.forEach(function (p) {
      p.update();
      var hit = p.checkBlockCollisions(self.demoBlocks);
      if (hit) self.effects.push(new Effect(hit.x, hit.y, 1, 15));
    });
    this.packets = this.packets.filter(function (p) { return !p.lost; });
    this.effects.forEach(function (e) { e.update(); });
    this.effects = this.effects.filter(function (e) { return !e.finished; });
  };
  Menu.prototype.buttons = function () {
    if (this.screen === 'main') return [this.playBtn];
    if (this.screen === 'info') return [this.startBtn];
    return [this.retryBtn, this.menuBtn];
  };
  Menu.prototype.onMove = function (p) {
    this.buttons().forEach(function (b) { b.hover = b.hit(p); });
  };
  Menu.prototype.onDown = function (p) {
    if (this.screen === 'main') {
      // the whole title screen acts as the Play button, as in the original
      this.screen = 'info';
    } else if (this.screen === 'info') {
      if (this.startBtn.hit(p) || p.y > this.h * 0.25) startGame();
    } else if (this.retryBtn.hit(p)) {
      startGame();
    } else if (this.menuBtn.hit(p)) {
      setScene(new Menu('main'));
    }
  };
  Menu.prototype.onKey = function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      if (this.screen === 'main') this.screen = 'info';
      else startGame();
    } else if (e.key === 'Escape' && this.screen !== 'main') {
      setScene(new Menu('main'));
    }
  };
  Menu.prototype.render = function () {
    var w = this.w, h = this.h;
    drawFieldBackground(w, h);
    if (this.screen === 'main') this.renderMain();
    else if (this.screen === 'info') this.renderInfo();
    else this.renderFailed();
  };
  Menu.prototype.renderMain = function () {
    var w = this.w, h = this.h;
    this.demoBlocks.forEach(function (b) { b.render(); });
    this.packets.forEach(function (p) { p.render(); });
    this.effects.forEach(function (e) { e.render(); });
    var top = Math.max(40, h * 0.12);
    var th = drawTitle(w / 2, top, Math.min(w - 50, 470));
    text('Keep ' + COMPANY + ' online', w / 2, top + th + 38, 20, COLORS.dim, 'center');
    // soft glow pulsing around the Play button
    ctx.save();
    ctx.shadowColor = 'rgba(229, 149, 0, 0.8)';
    ctx.shadowBlur = 12 + Math.sin(this.time / 18) * 8;
    this.playBtn.render();
    ctx.restore();
    var best = loadNumber('best');
    if (best > 0) {
      text('Best: online for ' + formatTime(best) + ', ' + loadNumber('bestRepairs') + ' regions repaired',
        w / 2, h - 18, 16, COLORS.dim, 'center');
    }
  };
  Menu.prototype.renderInfo = function () {
    var w = this.w, h = this.h;
    var maxW = Math.min(w - 40, w > h ? 700 : 560);
    var size, lh, iconH;
    var touch = isTouchUI();
    var items = [
      { t: 'You look after the servers in one of ' + COMPANY + '’s datacentres. The equipment is old and faulty, so it regularly needs a helping hand.' },
      { gap: 10 },
      { t: 'When a region goes down, make sure packets' },
      { icon: 'packet' },
      { t: 'reach every connection' },
      { icon: 'connection' },
      { t: 'by placing patch cables' },
      { icon: 'cable' },
      { t: 'before the connections time out and the datacentre goes offline.' },
      { gap: 10 },
      { t: touch
        ? 'Tap to place a cable. Drag from the spot before lifting your finger to aim it.'
        : 'Click to place a cable. Rotate it with the mouse wheel or Q / E (or drag while clicking to aim it).', color: COLORS.cursor },
      { t: 'Keep every connection green for a few seconds to repair the region. When you run out of cables, the oldest one is reused.', color: COLORS.dim }
    ];
    // measure, shrinking the text until everything fits above the button
    var total, laid;
    var room = this.startBtn.y - 24;
    for (size = 19; size >= 13; size--) {
      lh = Math.round(size * 1.3);
      iconH = Math.round(size * 1.5);
      total = 0;
      laid = items.map(function (it) {
        if (it.gap) { total += it.gap; return it; }
        if (it.icon) { total += iconH; return it; }
        it.lines = wrap(it.t, maxW, size);
        total += it.lines.length * lh;
        return it;
      });
      if (total <= room) break;
    }
    var y = Math.max(20, (this.startBtn.y - 14 - total) / 2) + lh / 2;
    var cx = w / 2;
    laid.forEach(function (it) {
      if (it.gap) { y += it.gap; return; }
      if (it.icon) {
        var iy = y + 2 - (30 - iconH) / 2;
        if (it.icon === 'packet') {
          new Packet(cx, iy, 0, 0, 7, w, h).render();
        } else if (it.icon === 'connection') {
          var c = new Connection(cx - 11, iy - 11, 22, 22, 100, 100);
          c.render();
        } else {
          new Block(cx, iy, 50, 5, 0).render();
        }
        y += iconH;
        return;
      }
      it.lines.forEach(function (line) {
        text(line, cx, y, size, it.color || COLORS.text, 'center');
        y += lh;
      });
    });
    this.startBtn.render();
  };
  Menu.prototype.renderFailed = function () {
    var w = this.w, h = this.h;
    var r = this.result || { seconds: 0, repaired: 0, newBest: false };
    var k = h < 480 ? 0.78 : 1; // tighter spacing on short (landscape phone) fields
    var top = Math.max(36, h * 0.14 * k);
    text('OFFLINE', w / 2, top + 20 * k, 64 * k, COLORS.bad, 'center', 'bold');
    var y = top + 90 * k;
    var lines = wrap('A connection timed out and ' + COMPANY + ' is in ruins.', w - 60, 20);
    lines.forEach(function (l) { text(l, w / 2, y, 20, COLORS.text, 'center'); y += 28; });
    y += 22 * k;
    text('You kept the datacentre online for', w / 2, y, 19, COLORS.dim, 'center');
    y += 40 * k;
    text(formatTime(r.seconds), w / 2, y, 48 * k, COLORS.packet, 'center', 'bold');
    y += 44 * k;
    text(r.repaired + (r.repaired === 1 ? ' region repaired' : ' regions repaired'), w / 2, y, 20, COLORS.text, 'center');
    y += 30 * k;
    if (r.newBest) {
      text('New personal best!', w / 2, y, 20, COLORS.cursor, 'center', 'bold');
    } else if (loadNumber('best') > 0) {
      text('Best: ' + formatTime(loadNumber('best')), w / 2, y, 18, COLORS.dim, 'center');
    }
    this.retryBtn.render();
    this.menuBtn.render();
  };

  // --- DataCenter: overview of the six regions ----------------------------------
  var REGIONS = ['NA', 'EU', 'AS', 'SA', 'AF', 'OC'];

  function DataCenter(level) {
    this.level = level;
    var failing = Math.floor(Math.random() * REGIONS.length);
    var delay = Math.max(60, 200 - level * 10);
    this.elements = REGIONS.map(function (name, i) {
      return new DataCenterElement(name, i === failing, delay);
    });
    this.failedElement = null;
    this.failTimer = 0;
    this.time = 0;
    this.relayout();
  }
  DataCenter.prototype.relayout = function () {
    var f = idealFieldSize();
    this.w = f.w; this.h = f.h;
    var cols = this.h > this.w * 1.1 ? 2 : 3;
    var rows = REGIONS.length / cols;
    var size = 84;
    var spacing = size + (cols === 3 ? 66 : 70);
    var gridW = (cols - 1) * spacing + size;
    var gridH = (rows - 1) * spacing + size;
    var startX = (this.w - gridW) / 2;
    var top = 140;
    var bottom = this.h - 70;
    var startY = top + Math.max(0, (bottom - top - gridH) / 2);
    this.elements.forEach(function (el, i) {
      el.size = size;
      el.x = startX + (i % cols) * spacing;
      el.y = startY + Math.floor(i / cols) * spacing;
    });
  };
  DataCenter.prototype.update = function () {
    this.time++;
    if (run.started) run.frames++;
    this.elements.forEach(function (el) { el.update(); });
    this.failedElement = this.elements.find(function (el) { return el.isFailed; }) || null;
    if (this.failedElement) {
      this.failTimer++;
      // Allow time for the failure animation, then dispatch automatically
      if (this.failTimer > 300) this.enter();
    }
  };
  DataCenter.prototype.enter = function () {
    if (!this.failedElement) return;
    setScene(new InsideElement(this.level, this.failedElement.name));
  };
  DataCenter.prototype.onDown = function (p) {
    if (this.failedElement && this.failedElement.hit(p)) this.enter();
  };
  DataCenter.prototype.onKey = function (e) {
    if (e.key === 'Enter' || e.key === ' ') this.enter();
  };
  DataCenter.prototype.render = function () {
    var w = this.w, h = this.h;
    drawFieldBackground(w, h);
    text(COMPANY, w / 2, 36, 26, COLORS.text, 'center', 'bold');
    text('System Overview', w / 2, 66, 19, COLORS.dim, 'center');
    setFont(22, 'bold');
    var label = 'System status: ';
    var status = this.failedElement ? 'ERROR' : 'OK';
    var lw = ctx.measureText(label).width;
    var sw = ctx.measureText(status).width;
    var sx = w / 2 - (lw + sw) / 2;
    text(label, sx, 104, 22, COLORS.text, 'left', 'bold');
    var blink = this.failedElement && Math.floor(this.time / 15) % 2 === 0;
    text(status, sx + lw, 104, 22, this.failedElement ? (blink ? COLORS.bad : '#ff8a94') : COLORS.ok, 'left', 'bold');
    this.elements.forEach(function (el) { el.render(); });
    if (this.failedElement) {
      var el = this.failedElement;
      var verb = isTouchUI() ? 'Tap' : 'Click';
      var msg = 'Region ' + el.name + ' is down! ' + verb + ' it to start repairs.';
      var lines = wrap(msg, w - 40, 19, 'bold');
      var y = h - 34 - (lines.length - 1) * 13;
      lines.forEach(function (l) { text(l, w / 2, y, 19, COLORS.cursor, 'center', 'bold'); y += 26; });
      // arrow ring around the failed region
      ctx.beginPath();
      ctx.arc(el.x + el.size / 2, el.y + el.size / 2, el.size * 0.75 + Math.sin(this.time / 6) * 4, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,174,25,0.7)';
      ctx.stroke();
    } else {
      var info = run.repaired > 0
        ? run.repaired + (run.repaired === 1 ? ' region repaired' : ' regions repaired') + '  ·  online ' + formatTime(run.frames / 60)
        : 'Monitoring all regions…';
      text(info, w / 2, h - 34, 18, COLORS.dim, 'center');
    }
  };

  // --- InsideElement: the actual repair puzzle ----------------------------------
  function InsideElement(level, regionName) {
    var f = idealFieldSize();
    this.w = f.w; this.h = f.h; // fixed for the whole level
    this.level = level;
    this.region = regionName;
    this.packets = [];
    this.spawners = [];
    this.effects = [];
    this.connections = [];
    this.blocks = [];
    this.frames = 0;
    this.endTimer = 0;
    this.outcome = null;
    if (level === 1 && !run.started) run.started = true;

    // Level parameters as in the original game
    this.timeToSuccess = level * 6000; // the original used level * 100 seconds
    var numProblems = 2 + Math.round(level / 2);
    this.blocksLimit = 2 + 2 * numProblems;
    var spawnerSpeed = 1 + level / 4;
    for (var i = 0; i < numProblems; i++) {
      this.spawners.push(new PacketSpawner(0.1, this.w, this.h, spawnerSpeed));
    }
    var successWait = 150;
    var failWait = 500 + 500 / level;
    var spots = this.pickConnectionSpots(numProblems, 22);
    for (var j = 0; j < spots.length; j++) {
      this.connections.push(new Connection(spots[j].x, spots[j].y, 22, 22, failWait, successWait));
    }

    // cursor cable
    this.cursor = new Block(this.w / 2, this.h / 2, 50, 5, 0);
    this.cursor.color = COLORS.cursor;
    this.cursorVisible = false;
    this.aim = null; // { x, y, px, py, dragging }
  }
  InsideElement.prototype.pickConnectionSpots = function (n, size) {
    var spots = [];
    var margin = 40;
    var minDist = 130;
    for (var tries = 0; spots.length < n && tries < 2000; tries++) {
      if (tries % 300 === 299) minDist *= 0.8;
      var x = rand(margin, this.w - margin - size);
      var y = rand(90, this.h - margin - size);
      var ok = true;
      for (var k = 0; k < spots.length; k++) {
        var dx = spots[k].x - x, dy = spots[k].y - y;
        if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
      }
      if (ok) spots.push({ x: x, y: y });
    }
    return spots;
  };
  InsideElement.prototype.placeCable = function (x, y, rotation) {
    if (this.blocks.length >= this.blocksLimit) this.blocks.shift();
    this.blocks.push(new Block(x, y, this.cursor.width, this.cursor.height, rotation));
  };
  InsideElement.prototype.rotate = function (dir) {
    this.cursor.rotation += dir * Math.PI / 8;
  };
  InsideElement.prototype.onMove = function (p, e) {
    if (this.aim) {
      var dx = p.x - this.aim.x, dy = p.y - this.aim.y;
      if (dx * dx + dy * dy > 14 * 14) {
        this.aim.dragging = true;
        this.cursor.rotation = Math.atan2(dy, dx);
      }
      this.aim.px = p.x; this.aim.py = p.y;
    } else if (e.pointerType === 'mouse') {
      this.cursor.x = p.x; this.cursor.y = p.y;
      this.cursorVisible = true;
    }
  };
  InsideElement.prototype.onDown = function (p, e) {
    if (this.outcome) return;
    if (e.button === 2) { this.rotate(1); return; }
    this.aim = { x: p.x, y: p.y, px: p.x, py: p.y, dragging: false };
    this.cursor.x = p.x; this.cursor.y = p.y;
  };
  InsideElement.prototype.onUp = function (p, e) {
    if (!this.aim) return;
    var a = this.aim;
    this.aim = null;
    if (this.outcome) return;
    if (e.type === 'pointercancel') return;
    if (a.x < -20 || a.y < -20 || a.x > this.w + 20 || a.y > this.h + 20) return;
    this.placeCable(a.x, a.y, this.cursor.rotation);
    if (e.pointerType !== 'mouse') this.cursorVisible = false;
  };
  InsideElement.prototype.onLeave = function () {
    this.cursorVisible = false;
  };
  InsideElement.prototype.onWheel = function (e) {
    if (e.deltaY < 0) this.rotate(-1);
    else if (e.deltaY > 0) this.rotate(1);
  };
  InsideElement.prototype.onKey = function (e) {
    var k = e.key.toLowerCase();
    if (k === 'q' || k === 'arrowleft' || k === 'a') this.rotate(-1);
    else if (k === 'e' || k === 'arrowright' || k === 'd' || k === 'r') this.rotate(1);
  };
  InsideElement.prototype.update = function () {
    var self = this;
    if (this.outcome) {
      this.endTimer++;
      this.effects.forEach(function (fx) { fx.update(); });
      if (this.outcome === 'failed') {
        if (this.endTimer > 100) gameOver();
      } else if (this.endTimer > 90) {
        run.repaired++;
        run.level++;
        setScene(new DataCenter(run.level));
      }
      return;
    }
    this.frames++;
    run.frames++;

    this.spawners.forEach(function (sp) {
      if (sp.checkSpawnPacket()) self.packets.push(sp.generatePacket());
    });
    this.packets.forEach(function (p) {
      p.update();
      var hit = p.checkBlockCollisions(self.blocks);
      if (hit) self.effects.push(new Effect(hit.x, hit.y, 1, 15));
    });

    var succeeded = 0;
    var failed = false;
    this.connections.forEach(function (c) {
      c.update();
      c.checkCollisions(self.packets);
      if (c.failed) failed = true;
      if (c.succeeded) succeeded++;
    });
    this.packets = this.packets.filter(function (p) { return !p.lost; });
    this.effects.forEach(function (fx) { fx.update(); });
    this.effects = this.effects.filter(function (fx) { return !fx.finished; });
    this.stable = succeeded;

    if (failed) {
      this.outcome = 'failed';
      this.endTimer = 0;
    } else if (succeeded === this.connections.length || this.frames >= this.timeToSuccess) {
      this.outcome = 'repaired';
      this.endTimer = 0;
    }
  };
  InsideElement.prototype.render = function () {
    var w = this.w, h = this.h;
    drawFieldBackground(w, h);
    this.packets.forEach(function (p) { p.render(); });
    this.connections.forEach(function (c) { c.render(); });
    this.blocks.forEach(function (b) { b.render(); });
    this.effects.forEach(function (fx) { fx.render(); });

    // ping labels
    this.connections.forEach(function (c) {
      var label = 'ping: ' + Math.floor(c.timeSinceLastPacket / 15);
      var lx = clamp(c.x + c.width / 2, 40, w - 40);
      text(label, lx, c.y - 16, 16, c.color === '#000000' ? COLORS.bad : c.color, 'center', 'bold');
    });

    // cursor / aiming preview
    if (!this.outcome) {
      if (this.aim) {
        if (this.aim.dragging) {
          ctx.beginPath();
          ctx.setLineDash([4, 6]);
          ctx.moveTo(this.aim.x, this.aim.y);
          ctx.lineTo(this.aim.px, this.aim.py);
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255,174,25,0.45)';
          ctx.stroke();
          ctx.setLineDash([]);
        }
        this.cursor.x = this.aim.x; this.cursor.y = this.aim.y;
        this.cursor.render(0.95);
      } else if (this.cursorVisible) {
        this.cursor.render(0.8);
      }
    }

    // HUD
    var left = this.blocksLimit - this.blocks.length;
    ctx.fillStyle = 'rgba(0, 20, 27, 0.6)';
    ctx.fillRect(0, 0, w, 58);
    text('Cables: ' + left + '/' + this.blocksLimit, 14, 19, 17, left > 0 ? COLORS.text : COLORS.cursor, 'left', 'bold');
    text('Region ' + this.region + ' · Level ' + this.level, w / 2, 19, 17, COLORS.text, 'center', 'bold');
    text('Online ' + formatTime(run.frames / 60), w - 14, 19, 17, COLORS.text, 'right', 'bold');
    text('Stable links: ' + (this.stable || 0) + '/' + this.connections.length, 14, 43, 15, COLORS.ok, 'left');
    var remain = (this.timeToSuccess - this.frames) / 60;
    text('Auto-recovery in ' + formatTime(remain), w - 14, 43, 15, COLORS.dim, 'right');

    // first-level reminder of the controls until the first cable is placed
    if (!this.outcome && this.level === 1 && this.blocks.length === 0) {
      var hint = isTouchUI()
        ? 'Tap to place a cable. Drag to aim it.'
        : 'Click to place a cable. Mouse wheel or Q / E rotates it.';
      var hl = wrap(hint, w - 40, 17, 'bold');
      var hy = h - 22 - (hl.length - 1) * 22;
      ctx.fillStyle = 'rgba(0, 20, 27, 0.6)';
      ctx.fillRect(0, hy - 18, w, hl.length * 22 + 14);
      hl.forEach(function (l) { text(l, w / 2, hy, 17, COLORS.cursor, 'center', 'bold'); hy += 22; });
    }

    if (this.outcome) {
      var a = Math.min(1, this.endTimer / 20);
      ctx.fillStyle = 'rgba(0, 10, 14,' + (0.55 * a) + ')';
      ctx.fillRect(0, 58, w, h - 58);
      ctx.fillStyle = 'rgba(0, 12, 17,' + (0.85 * a) + ')';
      ctx.fillRect(0, h / 2 - 50, w, 100);
      ctx.fillStyle = this.outcome === 'failed' ? 'rgba(255, 42, 61,' + a + ')' : 'rgba(0, 229, 45,' + a + ')';
      ctx.fillRect(0, h / 2 - 50, w, 2);
      ctx.fillRect(0, h / 2 + 48, w, 2);
      if (this.outcome === 'failed') {
        var on = Math.floor(this.endTimer / 10) % 2 === 0;
        text('CONNECTION TIMED OUT', w / 2, h / 2, Math.min(40, w / 13), on ? COLORS.bad : '#ff8a94', 'center', 'bold');
      } else {
        text('REGION ' + this.region + ' REPAIRED', w / 2, h / 2 - 10, Math.min(40, w / 13), COLORS.ok, 'center', 'bold');
        text('Back to the overview…', w / 2, h / 2 + 30, 19, COLORS.text, 'center');
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Flow
  // ---------------------------------------------------------------------------
  function startGame() {
    newRun();
    run.level = 1;
    setScene(new DataCenter(1));
  }

  function gameOver() {
    var seconds = run.frames / 60;
    var best = loadNumber('best');
    var newBest = seconds > best;
    if (newBest) {
      saveNumber('best', Math.round(seconds * 10) / 10);
      saveNumber('bestRepairs', run.repaired);
    }
    setScene(new Menu('failed', { seconds: seconds, repaired: run.repaired, newBest: newBest && best > 0 }));
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  var lastPointerType = '';
  var activePointer = null;

  canvas.addEventListener('pointerdown', function (e) {
    lastPointerType = e.pointerType || 'mouse';
    if (activePointer !== null && activePointer !== e.pointerId) return; // ignore extra fingers
    activePointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var p = toField(e);
    if (scene.onMove) scene.onMove(p, e);
    if (scene.onDown) scene.onDown(p, e);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (activePointer !== null && activePointer !== e.pointerId) return;
    if (e.pointerType === 'mouse') lastPointerType = 'mouse';
    if (scene.onMove) scene.onMove(toField(e), e);
  });
  function endPointer(e) {
    if (activePointer !== e.pointerId) return;
    activePointer = null;
    if (scene.onUp) scene.onUp(toField(e), e);
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function (e) {
    if (e.pointerType === 'mouse' && scene.onLeave) scene.onLeave();
  });
  canvas.addEventListener('wheel', function (e) {
    if (scene.onWheel) scene.onWheel(e);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('keydown', function (e) {
    if (scene.onKey) scene.onKey(e);
    if (e.key === ' ' || e.key.indexOf('Arrow') === 0) e.preventDefault();
  });

  // ---------------------------------------------------------------------------
  // Main loop (fixed timestep, paused while the page is hidden)
  // ---------------------------------------------------------------------------
  var lastTime = 0;
  var acc = 0;
  var paused = false;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastTime) lastTime = now;
    var dt = now - lastTime;
    lastTime = now;
    if (!paused) {
      acc += Math.min(dt, 250);
      var steps = 0;
      while (acc >= STEP && steps < 8) {
        scene.update();
        acc -= STEP;
        steps++;
      }
      if (steps === 8) acc = 0;
    }
    render();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var s = view.scale * dpr;
    ctx.setTransform(s, 0, 0, s, view.ox * dpr, view.oy * dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, scene.w, scene.h);
    ctx.clip();
    scene.render();
    ctx.restore();
    // subtle frame around the play field
    ctx.strokeStyle = 'rgba(52, 209, 191, 0.18)';
    ctx.lineWidth = 2 / view.scale;
    ctx.strokeRect(0, 0, scene.w, scene.h);
  }

  document.addEventListener('visibilitychange', function () {
    paused = document.hidden;
    lastTime = 0;
    acc = 0;
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 100); });

  // Debug/screenshot hook (harmless for players)
  window.__dcs = {
    get scene() { return scene; },
    get run() { return run; },
    startGame: startGame,
    setScene: setScene,
    Menu: Menu,
    DataCenter: DataCenter,
    InsideElement: InsideElement
  };

  resize();
  setScene(new Menu('main'));
  requestAnimationFrame(frame);
})();
