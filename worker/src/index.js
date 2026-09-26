const NOTION_VERSION = "2025-09-03";
const DATA_SOURCE_ID = "ee487ac4-512d-829e-8a7f-87b16ce7e678";
const DONE_STATUS = "完了";
const ACTIVE_STATUSES = ["ToDo", "やった方がいいこと", "やりたいこと"];

const ALLOWED_ORIGINS = [
  "https://kokishukuwa-dev.github.io",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
];

const PAGE_ID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function corsHeaders(origin) {
  // 許可外のOriginにはCORSヘッダーを返さない（ブラウザ経由の読み取りを許さない）
  if (!ALLOWED_ORIGINS.includes(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function normalizeId(id) {
  return String(id || "").replace(/-/g, "").toLowerCase();
}

// Notionのエラー本文はログにだけ残し、クライアントには返さない
async function notionFailure(res, error, origin) {
  console.error(error, res.status, await res.text());
  return json({ error }, 502, origin);
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

async function statusPropertyId(env) {
  const res = await fetch(`https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}`, {
    headers: notionHeaders(env.NOTION_TOKEN),
  });
  if (!res.ok) throw new Error(`schema request failed: ${res.status}`);

  const data = await res.json();
  const status = Object.values(data.properties).find((property) => property.type === "status");
  if (!status) throw new Error("status property not found");
  return status.id;
}

function toTask(page, statusId) {
  const p = page.properties;
  const status = Object.values(p).find((property) => property.id === statusId);
  return {
    id: page.id,
    name: extractTitle(p["タスク名"]),
    status: status?.status?.name ?? null,
    labels: (p["ラベル"]?.multi_select || []).map((o) => o.name),
    priority: p["優先度"]?.select?.name ?? null,
    due: p["期限"]?.date?.start ?? null,
    createdTime: page.created_time,
  };
}

async function listTasks(env, origin) {
  let statusId;
  try {
    statusId = await statusPropertyId(env);
  } catch (error) {
    console.error("notion_schema_failed", error.message);
    return json({ error: "notion_schema_failed" }, 502, origin);
  }

  const res = await fetch(
    `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`,
    {
      method: "POST",
      headers: notionHeaders(env.NOTION_TOKEN),
      body: JSON.stringify({
        filter: {
          or: ACTIVE_STATUSES.map((name) => ({
            property: statusId,
            status: { equals: name },
          })),
        },
        page_size: 100,
      }),
    }
  );
  if (!res.ok) return notionFailure(res, "notion_query_failed", origin);
  const data = await res.json();
  const tasks = data.results.map((page) => toTask(page, statusId));
  return json({ tasks }, 200, origin);
}

async function completeTask(env, origin, pageId) {
  if (!PAGE_ID_PATTERN.test(pageId)) {
    return json({ error: "invalid_task_id" }, 400, origin);
  }

  // タスクDB以外のページを書き換えないよう、親データソースを確かめてから更新する
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: notionHeaders(env.NOTION_TOKEN),
  });
  if (pageRes.status === 404) return json({ error: "not_found" }, 404, origin);
  if (!pageRes.ok) return notionFailure(pageRes, "notion_page_failed", origin);
  const page = await pageRes.json();
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(DATA_SOURCE_ID)) {
    return json({ error: "not_found" }, 404, origin);
  }

  let statusId;
  try {
    statusId = await statusPropertyId(env);
  } catch (error) {
    console.error("notion_schema_failed", error.message);
    return json({ error: "notion_schema_failed" }, 502, origin);
  }

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(env.NOTION_TOKEN),
    body: JSON.stringify({
      properties: {
        [statusId]: { status: { name: DONE_STATUS } },
        完了日: { date: { start: new Date().toISOString().slice(0, 10) } },
      },
    }),
  });
  if (!res.ok) return notionFailure(res, "notion_update_failed", origin);
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
