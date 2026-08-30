const NOTION_VERSION = "2025-09-03";
const DATA_SOURCE_ID = "ee487ac4-512d-829e-8a7f-87b16ce7e678";
const DONE_STATUS = "完了";
const ACTIVE_STATUSES = ["ToDo", "やった方がいいこと", "やりたいこと"];

const ALLOWED_ORIGINS = [
  "https://kokishukuwa-dev.github.io",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

function notionHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

function extractTitle(prop) {
  return (prop?.title || []).map((t) => t.plain_text).join("");
}

function toTask(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: extractTitle(p["タスク名"]),
    status: p["ステータス"]?.status?.name ?? null,
    labels: (p["ラベル"]?.multi_select || []).map((o) => o.name),
    priority: p["優先度"]?.select?.name ?? null,
    due: p["期限"]?.date?.start ?? null,
    createdTime: page.created_time,
  };
}

async function listTasks(env, origin) {
  const res = await fetch(
    `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`,
    {
      method: "POST",
      headers: notionHeaders(env.NOTION_TOKEN),
      body: JSON.stringify({
        filter: {
          or: ACTIVE_STATUSES.map((name) => ({
            property: "ステータス",
            status: { equals: name },
          })),
        },
        page_size: 100,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    return json({ error: "notion_query_failed", detail: text }, 502, origin);
  }
  const data = await res.json();
  const tasks = data.results.map(toTask);
  return json({ tasks }, 200, origin);
}

async function completeTask(env, origin, pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(env.NOTION_TOKEN),
    body: JSON.stringify({
      properties: {
        ステータス: { status: { name: DONE_STATUS } },
        完了日: { date: { start: new Date().toISOString().slice(0, 10) } },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: "notion_update_failed", detail: text }, 502, origin);
  }
  return json({ ok: true }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname === "/api/tasks" && request.method === "GET") {
      return listTasks(env, origin);
    }

    const completeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
    if (completeMatch && request.method === "PATCH") {
      return completeTask(env, origin, completeMatch[1]);
    }

    return json({ error: "not_found" }, 404, origin);
  },
};
