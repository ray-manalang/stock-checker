import { useEffect, useRef, useState } from "react";
import { getCnbcVideos, type CnbcVideo } from "./api";

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

/**
 * "Latest from CNBC" — market video from CNBC Television's YouTube feed.
 * Clicking a thumbnail plays the clip inline via YouTube's embed.
 */
export function CnbcVideos() {
  const [videos, setVideos] = useState<CnbcVideo[]>([]);
  const [active, setActive] = useState<CnbcVideo | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    const load = () =>
      getCnbcVideos()
        .then((v) => live.current && setVideos(v))
        .catch(() => {});
    load();
    const id = setInterval(load, 10 * 60 * 1000); // refresh ~every 10 min
    return () => {
      live.current = false;
      clearInterval(id);
    };
  }, []);

  if (!videos.length) return null;

  return (
    <div className="insight-card">
      <div className="insight-head">
        <div>
          <h3>Latest from CNBC</h3>
          <div className="subtitle">Market video from CNBC Television.</div>
        </div>
        {active && (
          <button className="btn-ghost btn-sm" onClick={() => setActive(null)}>
            ✕ Close
          </button>
        )}
      </div>
      <div className="insight-divider" />

      {active && (
        <div className="cnbc-player">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${active.id}?autoplay=1&rel=0`}
            title={active.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
          <div className="cnbc-player-title">{active.title}</div>
        </div>
      )}

      <div className="cnbc-grid">
        {videos.map((v) => (
          <button
            key={v.id}
            className={`cnbc-item ${active?.id === v.id ? "on" : ""}`}
            onClick={() => setActive(v)}
            title={v.title}
          >
            <span className="cnbc-thumb">
              {v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" />}
              <span className="cnbc-play">▶</span>
            </span>
            <span className="cnbc-vtitle">{v.title}</span>
            <span className="cnbc-time">{ago(v.published)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
