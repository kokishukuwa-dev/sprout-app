(function () {
  var API_BASE = "https://sprout-app-proxy.sprout-app-proxy.workers.dev";
  var UNCATEGORIZED = "未分類";
  var SPROUT_EMOJI = {};
  var DEFAULT_SPROUT = "🌱";

  var state = {
    tasks: [],
    filter: "すべて",
    loading: true,
    error: null,
  };

  function priorityRank(p) {
    if (p === "高") return 0;
    if (p === "中") return 1;
    if (p === "低") return 2;
    return 3;
  }
  function statusRank(s) {
    if (s === "ToDo") return 0;
    if (s === "やった方がいいこと") return 1;
    if (s === "やりたいこと") return 2;
    return 3;
  }
  // GTD基準: 優先度 > 期限 > 実行段階の近さ > 登録順、の順で次アクションを1件に絞る
  function compareTasks(a, b) {
    var pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    var ad = a.due ? Date.parse(a.due) : Infinity;
    var bd = b.due ? Date.parse(b.due) : Infinity;
    if (ad !== bd) return ad - bd;
    var sr = statusRank(a.status) - statusRank(b.status);
    if (sr !== 0) return sr;
    return Date.parse(a.createdTime) - Date.parse(b.createdTime);
  }

  function projectOf(task) {
    return task.labels && task.labels.length ? task.labels[0] : UNCATEGORIZED;
  }
  function sproutOf(proj) {
    return SPROUT_EMOJI[proj] || DEFAULT_SPROUT;
  }

  function projectList() {
    var seen = {};
    var order = [];
    state.tasks.forEach(function (t) {
      var p = projectOf(t);
      if (!seen[p]) {
        seen[p] = true;
        order.push(p);
      }
    });
    return order;
  }

  function openOf(proj) {
    return state.tasks
      .filter(function (t) {
        return projectOf(t) === proj;
      })
      .sort(compareTasks);
  }

  function topTask() {
    if (!state.tasks.length) return null;
    return state.tasks.slice().sort(compareTasks)[0];
  }

  async function fetchTasks() {
    state.loading = true;
    state.error = null;
    render();
    try {
      var res = await fetch(API_BASE + "/api/tasks");
      if (!res.ok) throw new Error("status " + res.status);
      var data = await res.json();
      state.tasks = data.tasks || [];
      state.loading = false;
    } catch (e) {
      console.error(e);
      state.loading = false;
      state.error = "タスクを取得できなかった。時間をおいて開き直して";
    }
    render();
  }

  async function completeTask(id) {
    var task = state.tasks.find(function (t) {
      return t.id === id;
    });
    if (!task) return;
    state.tasks = state.tasks.filter(function (t) {
      return t.id !== id;
    });
    render();
    try {
      var res = await fetch(API_BASE + "/api/tasks/" + encodeURIComponent(id) + "/complete", {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("status " + res.status);
    } catch (e) {
      state.tasks.push(task);
      render();
      showToast("完了の反映に失敗した。もう一度お試しを");
    }
  }

  var toastTimer = null;
  function showToast(message) {
    var el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 3200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderTop() {
    var el = document.getElementById("top");
    var task = topTask();
    if (!task) {
      el.innerHTML = '<div class="pin-empty">今日やることは全部片づいた。お疲れさま。</div>';
      return;
    }
    el.innerHTML =
      '<div class="pin-card">' +
      '<span class="mark">📌</span>' +
      '<div class="body">' +
      '<div class="pin-label">今日の最優先</div>' +
      '<div class="pin-proj">' + escapeHtml(projectOf(task)) + "</div>" +
      '<div class="pin-text">' + escapeHtml(task.name) + "</div>" +
      '<button class="pin-done" data-id="' + escapeHtml(task.id) + '">完了にする</button>' +
      "</div></div>";
    el.querySelector(".pin-done").addEventListener("click", function () {
      completeTask(task.id);
    });
  }

  function renderFilters() {
    var el = document.getElementById("filters");
    var projects = projectList();
    var chips = ["すべて"].concat(projects);
    el.innerHTML = chips
      .map(function (p) {
        var active = p === state.filter ? " active" : "";
        return '<button class="chip' + active + '" data-p="' + escapeHtml(p) + '">' + escapeHtml(p) + "</button>";
      })
      .join("");
    el.querySelectorAll(".chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.filter = btn.getAttribute("data-p");
        render();
      });
    });
  }

  function renderStage() {
    var stage = document.getElementById("stage");

    if (state.loading) {
      stage.innerHTML = '<div class="loading">読み込み中…</div>';
      return;
    }
    if (state.error) {
      stage.innerHTML = '<div class="error">' + escapeHtml(state.error) + "</div>";
      return;
    }

    if (state.filter === "すべて") {
      var projects = projectList().sort(function (a, b) {
        var oa = openOf(a).length,
          ob = openOf(b).length;
        return oa === 0 && ob !== 0 ? 1 : ob === 0 && oa !== 0 ? -1 : 0;
      });
      if (!projects.length) {
        stage.innerHTML = '<div class="focus-empty">タスクが見つからない。Notion側を確認して。</div>';
        return;
      }
      var html = '<div class="card-grid">';
      projects.forEach(function (proj) {
        var open = openOf(proj);
        var head = open[0];
        html += '<div class="card' + (open.length === 0 ? " empty" : "") + '">';
        html += '<div class="proj">' + escapeHtml(proj) + "</div>";
        html += '<div class="next"><span class="sprout">' + (open.length ? sproutOf(proj) : "✓") + "</span>";
        html += '<span class="text">' + escapeHtml(head ? head.name : "") + "</span></div>";
        if (open.length > 1) {
          html += '<div class="more">他 ' + (open.length - 1) + " 件</div>";
        } else if (open.length === 0) {
          html += '<div class="more">今日の分は完了</div>';
        }
        html += '<button class="goto" data-p="' + escapeHtml(proj) + '">この1件に集中する →</button>';
        html += "</div>";
      });
      html += "</div>";
      stage.innerHTML = html;
      stage.querySelectorAll(".goto").forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.filter = btn.getAttribute("data-p");
          render();
        });
      });
      return;
    }

    var proj = state.filter;
    var open = openOf(proj);
    var html2 = '<div class="focus-head"><span class="proj">' + escapeHtml(proj) + "</span></div>";

    if (open.length === 0) {
      html2 += '<div class="focus-empty">' + escapeHtml(proj) + "の次アクションは今すべて完了。<br>お疲れさま。</div>";
      stage.innerHTML = html2;
      return;
    }

    var head2 = open[0];
    html2 += '<div class="focus-main">';
    html2 += '<span class="sprout">' + sproutOf(proj) + "</span>";
    html2 += "<div><div class=\"text\">" + escapeHtml(head2.name) + "</div>";
    html2 += '<div class="meta">';
    if (head2.priority) html2 += '<span class="tag">優先度: ' + escapeHtml(head2.priority) + "</span>";
    if (head2.due) html2 += '<span class="tag">期限: ' + escapeHtml(head2.due) + "</span>";
    html2 += "</div>";
    html2 += '<button class="focus-done" data-id="' + escapeHtml(head2.id) + '">完了にする</button></div>';
    html2 += "</div>";

    if (open.length > 1) {
      html2 += '<div class="focus-list-label">この後に控えている次アクション</div>';
      open.slice(1).forEach(function (t) {
        html2 += '<div class="focus-row">';
        html2 += '<button class="focus-check" data-id="' + escapeHtml(t.id) + '" aria-label="完了にする"></button>';
        html2 += '<span class="rtext">' + escapeHtml(t.name) + "</span>";
        html2 += '<span class="rctx">' + escapeHtml(t.priority || "") + "</span>";
        html2 += "</div>";
      });
    }
    stage.innerHTML = html2;
    stage.querySelectorAll("[data-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        completeTask(btn.getAttribute("data-id"));
      });
    });
  }

  function render() {
    renderTop();
    renderFilters();
    renderStage();
  }

  fetchTasks();
})();
