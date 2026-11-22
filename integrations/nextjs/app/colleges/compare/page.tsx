// Example: college directory from a LayerFlow dataset + the real-time comparison assistant.
// Copy to `app/colleges/compare/page.tsx`. The table is server-rendered (SEO-friendly, refreshed when the
// dataset_builder agents update records); the assistant is the drop-in widget.
import Script from "next/script";
import { getRecords } from "@/lib/layerflow";

export const revalidate = 600;

type College = {
  name: string;
  city: string;
  nirf_rank: number;
  fees_total: number;
  avg_package: number;
  placement_rate: number;
};

export default async function CompareColleges() {
  const { items } = await getRecords<College>("colleges", { sort: "nirf_rank:asc", limit: 100 });
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 20px" }}>
      <h1>Compare colleges</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">College</th>
            <th align="left">City</th>
            <th align="right">NIRF</th>
            <th align="right">Total fees (₹)</th>
            <th align="right">Avg package (LPA)</th>
            <th align="right">Placement %</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ key, data }) => (
            <tr key={key} style={{ borderTop: "1px solid #eee" }}>
              <td>{data.name}</td>
              <td>{data.city}</td>
              <td align="right">{data.nirf_rank}</td>
              <td align="right">{data.fees_total?.toLocaleString("en-IN")}</td>
              <td align="right">{data.avg_package}</td>
              <td align="right">{data.placement_rate}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Inline assistant. A public key with only the assistant:chat scope is safe to expose in the browser. */}
      <div id="compare-assistant" style={{ marginTop: 32 }} />
      <Script
        src={`${process.env.NEXT_PUBLIC_LAYERFLOW_URL}/widget.js`}
        data-key={process.env.NEXT_PUBLIC_LAYERFLOW_CHAT_KEY}
        data-dataset="colleges"
        data-title="Ask & compare colleges"
        data-inline="#compare-assistant"
        strategy="afterInteractive"
      />
    </main>
  );
}
