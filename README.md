# 発芽

Notionのタスク管理DBから、プロジェクト(ラベル)ごとの次アクションを表示するタスク管理アプリ。

- `index.html` / `app.js` / `style.css`: フロントエンド(GitHub Pagesで配信)
- `worker/`: Cloudflare Workers製のNotion APIプロキシ。Notionのシークレットトークンはここに secret として保持し、クライアントには渡さない。

## Workerのデプロイ

```
cd worker
npx wrangler secret put NOTION_TOKEN
npx wrangler deploy
```
