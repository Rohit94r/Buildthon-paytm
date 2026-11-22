// Example: news listing powered by LayerFlow agents. Copy to `app/news/page.tsx`.
import Link from "next/link";
import { getPosts } from "@/lib/layerflow";

export const revalidate = 300;

export default async function NewsPage() {
  const { items } = await getPosts({ limit: 20, format: "article" });
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px" }}>
      <h1>Latest</h1>
      {items.map((p) => (
        <article key={p.id} style={{ padding: "20px 0", borderBottom: "1px solid #eee" }}>
          <Link href={`/news/${p.slug}`}>
            <h2 style={{ margin: 0 }}>{p.title}</h2>
          </Link>
          <p style={{ color: "#555" }}>{p.summary}</p>
          <small>{new Date(p.published_at).toLocaleString()}</small>
        </article>
      ))}
    </main>
  );
}
