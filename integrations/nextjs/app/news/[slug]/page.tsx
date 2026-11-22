// Example: article page with SEO metadata + JSON-LD from the LayerFlow SEO agent. Copy to `app/news/[slug]/page.tsx`.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPost } from "@/lib/layerflow";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return {};
  return {
    title: post.seo?.title_tag || post.title,
    description: post.seo?.meta_description || post.summary,
    openGraph: { title: post.title, description: post.summary, images: post.image_url ? [post.image_url] : [] },
  };
}

export default async function PostPage({ params }: Props) {
  const post = await getPost((await params).slug);
  if (!post) notFound();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px" }}>
      {post.seo?.json_ld ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(post.seo.json_ld) }} />
      ) : null}
      <h1>{post.title}</h1>
      <p style={{ color: "#555" }}>{post.summary}</p>
      {/* body_html is sanitized server-side by LayerFlow */}
      <div dangerouslySetInnerHTML={{ __html: post.body_html }} />
    </main>
  );
}
