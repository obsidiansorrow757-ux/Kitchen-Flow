/* =====================================================================
   Desktop bridge — only active inside the desktop app (window.desktop).
   Opened in a plain browser, index.html behaves exactly as before.

   Adds: real Save / Save As / Open dialogs, remembers the current file,
   "unsaved changes" tracking (title shows •, prompts before New/Open/close),
   drag a .json onto the window to open it, and the native menu.
   ===================================================================== */
(function () {
  if (!window.desktop) return;
  var D = window.desktop;
  var currentPath = null;
  var dirty = false;

  function baseName(p) { return p ? String(p).split(/[\\/]/).pop() : 'Untitled'; }
  function updTitle() { D.setTitle((dirty ? '• ' : '') + baseName(currentPath) + ' — KitchenFlow'); }
  function setDirty(v) { v = !!v; if (dirty === v) return; dirty = v; D.setDirty(v); updTitle(); }

  /* ---- anything that changes the drawing marks it unsaved ---- */
  ['pushUndo', 'addSlabFromImage', 'removeSlab', 'setSlabWidth'].forEach(function (n) {
    var orig = window[n];
    if (typeof orig !== 'function') return;
    window[n] = function () { var r = orig.apply(this, arguments); setDirty(true); return r; };
  });
  ['undoAction', 'redoAction'].forEach(function (n) {
    var orig = window[n];
    if (typeof orig !== 'function') return;
    window[n] = function () {
      var before = undoStack.length;
      var r = orig.apply(this, arguments);
      if (undoStack.length !== before) setDirty(true);
      return r;
    };
  });

  /* ---- file contents: same format the browser version saves ---- */
  function serialize() {
    var slabsOut = slabs.map(function (s) { return { id: s.id, dataUrl: s.dataUrl, wIn: s.wIn, hIn: s.hIn }; });
    return JSON.stringify({ walls: walls, cabinets: cabinets, counters: counters, dims: dims, windows: windows, doors: doors, elevDims: elevDims, backsplashes: backsplashes, waterfalls: waterfalls, slabs: slabsOut }, null, 1);
  }

  // New objects get ids from a counter that starts at 1 every launch. After
  // loading a file, start it past every id in the file so a new wall can never
  // reuse the id of a loaded wall (windows/doors/backsplash find walls by id).
  function bumpIdCounter() {
    var max = 0;
    [walls, cabinets, counters, dims, windows, doors, elevDims, backsplashes, waterfalls, slabs].forEach(function (arr) {
      (arr || []).forEach(function (o) {
        var m = o && typeof o.id === 'string' && o.id.match(/^o(\d+)$/);
        if (m) max = Math.max(max, +m[1]);
      });
    });
    if (max >= _uid) _uid = max + 1;
  }

  function exitSpecialViews() {
    if (viewMode === '3d') leave3D();
    if (viewMode === 'elevation') toggleFrontView();
  }

  function applyData(s, onDone) {
    exitSpecialViews();
    walls = s.walls || []; cabinets = s.cabinets || []; counters = s.counters || []; dims = s.dims || [];
    windows = s.windows || []; doors = s.doors || []; elevDims = s.elevDims || [];
    backsplashes = s.backsplashes || []; waterfalls = s.waterfalls || [];
    undoStack = []; redoStack = [];
    sel.clear(); showProps(); zoomFit();
    var slabsIn = s.slabs || [], loaded = new Array(slabsIn.length), pending = slabsIn.length, fixes = 0;
    slabs = [];
    function finish() {
      slabs = loaded.filter(Boolean); // keeps the saved slab order (Slab 1, Slab 2...)
      bumpIdCounter();
      buildSlabListUI(); redraw();
      if (slabPanelOn) { resetSlabPanelView(); drawSlabLayout(); }
      if (fixes) toast('Corrected ' + fixes + ' slab height(s) to match the photo — pieces that no longer fit show orange in Slab Layout');
      if (onDone) onDone();
    }
    if (!pending) { finish(); return; }
    slabsIn.forEach(function (sd, i) {
      var img = new Image();
      img.onload = function () {
        var ns = { id: sd.id, img: img, dataUrl: sd.dataUrl, wIn: sd.wIn, hIn: sd.hIn };
        if (matchSlabToPhoto(ns)) fixes++;
        loaded[i] = ns;
        if (--pending <= 0) finish();
      };
      img.onerror = function () { if (--pending <= 0) finish(); };
      img.src = sd.dataUrl;
    });
  }

  /* ---- save / open / new ---- */
  async function saveLayout(asNew) {
    try {
      var data = serialize(), p;
      if (!asNew && currentPath) p = await D.save(currentPath, data);
      else p = await D.saveAs(data, currentPath ? baseName(currentPath) : 'kitchen-layout.json');
      if (!p) return false;
      currentPath = p;
      setDirty(false); updTitle();
      toast('Saved ' + baseName(p));
      return true;
    } catch (err) {
      alert('Could not save the file:\n' + (err && err.message ? err.message : err));
      return false;
    }
  }

  // true = OK to throw away the current drawing
  async function okToDiscard() {
    if (!dirty) return true;
    var r = await D.askSaveChanges();
    if (r === 0) return await saveLayout(false);
    return r === 1;
  }

  async function openLayout(path) {
    if (!(await okToDiscard())) return;
    var r;
    try { r = path ? await D.readFile(path) : await D.open(); }
    catch (err) { alert('Could not open the file:\n' + (err && err.message ? err.message : err)); return; }
    if (!r) return;
    var s;
    try { s = JSON.parse(r.text); } catch (err) { alert('That file is not a valid layout file.'); return; }
    applyData(s, function () {
      currentPath = r.path;
      dirty = true; setDirty(false); updTitle();
      toast('Opened ' + baseName(r.path));
    });
  }

  async function newLayout() {
    if (!(await okToDiscard())) return;
    exitSpecialViews();
    walls = []; cabinets = []; counters = []; dims = []; windows = []; doors = []; elevDims = []; backsplashes = []; waterfalls = []; slabs = [];
    undoStack = []; redoStack = [];
    buildSlabListUI(); sel.clear(); showProps(); redraw();
    if (slabPanelOn) drawSlabLayout();
    currentPath = null;
    dirty = true; setDirty(false); updTitle();
  }

  // Point the page's own buttons at the desktop versions
  window.doSave = function () { saveLayout(false); };
  window.doSaveAs = function () { saveLayout(true); };
  window.doNew = function () { newLayout(); };
  var loadInput = document.getElementById('loadFile');
  if (loadInput) loadInput.click = function () { openLayout(); };

  // Add a "Save As" button next to Save in the File toolbar group
  var fileGroup = document.querySelector('#tg-file .tg-b');
  if (fileGroup) {
    var btns = fileGroup.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.trim() === 'Save') {
        var sa = document.createElement('button');
        sa.className = 'bt'; sa.textContent = 'Save As';
        sa.onclick = function () { saveLayout(true); };
        btns[i].after(sa);
        break;
      }
    }
  }

  /* ---- drop a .json layout onto the window to open it ---- */
  document.addEventListener('dragover', function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault();
  });
  document.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    e.preventDefault();
    var f = files[0];
    if (!/\.json$/i.test(f.name)) { toast('Drop a layout .json file to open it'); return; }
    var p = D.pathForFile(f);
    if (p) openLayout(p);
  });

  /* ---- native menu ---- */
  D.onMenu(function (action, arg) {
    switch (action) {
      case 'new': newLayout(); break;
      case 'open': openLayout(); break;
      case 'open-path': openLayout(arg); break;
      case 'save': saveLayout(false); break;
      case 'save-as': saveLayout(true); break;
      case 'save-then-close': saveLayout(false).then(function (ok) { if (ok) D.closeNow(); }); break;
      case 'print': printLayout(); break;
      case 'undo': if (viewMode !== '3d') undoAction(); break;
      case 'redo': if (viewMode !== '3d') redoAction(); break;
      case 'fit': zoomFit(); break;
      case 'front': toggleFrontView(); break;
      case '3d': toggle3D(); break;
      case 'slab': toggleSlabPanel(); break;
    }
  });

  updTitle();

  // A layout passed on launch ("Open with" / double-click). Wait for the page's init.
  window.addEventListener('load', function () {
    setTimeout(function () {
      D.getStartupFile().then(function (p) { if (p) openLayout(p); });
    }, 0);
  });
})();
