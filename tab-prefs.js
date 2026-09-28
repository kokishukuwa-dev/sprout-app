// タブの「起動時に開くタブ」と並び順を、右クリック（スマホは長押し）とドラッグで変える。
// 画面にはボタンを増やさず、設定は端末ごとに localStorage へ保存する。
(function () {
  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch (e) {
      return {};
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // 保存できない環境でも操作自体は続ける
    }
  }

  var menuEl = null;
  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }

  // items: [{label, checked, disabled, run}] または "-"（区切り線）
  function openMenu(x, y, items) {
    closeMenu();
    menuEl = document.createElement("div");
    menuEl.className = "ctx-menu";
    menuEl.setAttribute("role", "menu");
    items.forEach(function (it) {
      if (it === "-") {
        var sep = document.createElement("div");
        sep.className = "ctx-sep";
        menuEl.appendChild(sep);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.className = "ctx-item" + (it.checked ? " checked" : "");
      b.disabled = !!it.disabled;
      b.textContent = it.label;
      b.addEventListener("click", function () {
        closeMenu();
        it.run();
      });
      menuEl.appendChild(b);
    });
    document.body.appendChild(menuEl);
    var r = menuEl.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - r.width - 8);
    var top = Math.min(y, window.innerHeight - r.height - 8);
    menuEl.style.left = Math.max(8, left) + "px";
    menuEl.style.top = Math.max(8, top) + "px";
    var first = menuEl.querySelector("button:not(:disabled)");
    if (first) first.focus({ preventScroll: true });
  }

  document.addEventListener(
    "pointerdown",
    function (e) {
      if (menuEl && !menuEl.contains(e.target)) closeMenu();
    },
    true
  );
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenu();
  });
  window.addEventListener("resize", closeMenu);
  window.addEventListener("blur", closeMenu);
  document.addEventListener("scroll", closeMenu, true);

  // 右クリックと長押しの両方で handler(x, y) を呼ぶ
  function onContext(el, handler) {
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      handler(e.clientX, e.clientY);
    });
    var timer = null;
    var fired = false;
    el.addEventListener(
      "touchstart",
      function (e) {
        fired = false;
        var t = e.touches[0];
        timer = setTimeout(function () {
          fired = true;
          handler(t.clientX, t.clientY);
        }, 550);
      },
      { passive: true }
    );
    ["touchmove", "touchend", "touchcancel"].forEach(function (type) {
      el.addEventListener(type, function () {
        clearTimeout(timer);
      });
    });
    // 長押しで開いた直後のタップをタブ切り替えとして扱わない
    el.addEventListener(
      "click",
      function (e) {
        if (fired) {
          fired = false;
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true
    );
  }

  function sort(key, ids) {
    var saved = (read(key).order || []).filter(function (id) {
      return ids.indexOf(id) !== -1;
    });
    ids.forEach(function (id) {
      if (saved.indexOf(id) === -1) saved.push(id);
    });
    return saved;
  }

  function getDefault(key, ids, fallback) {
    var d = read(key).default;
    return ids.indexOf(d) !== -1 ? d : fallback;
  }

  var dragging = null;

  // 1つのタブ要素に右クリックメニューとドラッグ並び替えを付ける。
  // ids は現在の全タブID、onChange は保存後に呼ばれる（並べ直し・再描画用）。
  function bind(key, el, id, ids, onChange) {
    function move(targetIndex) {
      var order = sort(key, ids).filter(function (x) {
        return x !== id;
      });
      order.splice(targetIndex, 0, id);
      var p = read(key);
      p.order = order;
      write(key, p);
      onChange();
    }
    onContext(el, function (x, y) {
      var order = sort(key, ids);
      var i = order.indexOf(id);
      var isDefault = getDefault(key, ids, null) === id;
      openMenu(x, y, [
        {
          label: isDefault ? "起動時に開くタブ（設定中）" : "起動時にこのタブを開く",
          checked: isDefault,
          disabled: isDefault,
          run: function () {
            var p = read(key);
            p.default = id;
            write(key, p);
            onChange();
          },
        },
        "-",
        { label: "左へ移動", disabled: i <= 0, run: function () { move(i - 1); } },
        { label: "右へ移動", disabled: i >= order.length - 1, run: function () { move(i + 1); } },
        "-",
        {
          label: "並びと起動時のタブを元に戻す",
          run: function () {
            write(key, {});
            onChange();
          },
        },
      ]);
    });

    el.draggable = true;
    el.addEventListener("dragstart", function (e) {
      dragging = { key: key, id: id };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    });
    el.addEventListener("dragend", function () {
      dragging = null;
    });
    el.addEventListener("dragover", function (e) {
      if (dragging && dragging.key === key && dragging.id !== id) e.preventDefault();
    });
    el.addEventListener("drop", function (e) {
      if (!dragging || dragging.key !== key || dragging.id === id) return;
      e.preventDefault();
      var from = dragging.id;
      dragging = null;
      var r = el.getBoundingClientRect();
      var after = e.clientX > r.left + r.width / 2;
      var order = sort(key, ids).filter(function (x) {
        return x !== from;
      });
      order.splice(order.indexOf(id) + (after ? 1 : 0), 0, from);
      var p = read(key);
      p.order = order;
      write(key, p);
      onChange();
    });
  }

  // 静的なタブ列を保存済みの順に並べ直す。tabs: {id: 要素}
  function arrange(key, container, tabs) {
    sort(key, Object.keys(tabs)).forEach(function (id) {
      container.appendChild(tabs[id]);
    });
  }

  window.TabPrefs = {
    read: read,
    write: write,
    openMenu: openMenu,
    onContext: onContext,
    sort: sort,
    getDefault: getDefault,
    bind: bind,
    arrange: arrange,
  };
})();
