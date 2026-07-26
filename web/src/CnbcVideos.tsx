import { FormEvent, useEffect, useRef, useState } from "react";
import {
  getCnbcVideos,
  getVideoSources,
  addVideoSource,
  removeVideoSource,
  type CnbcVideo,
  type VideoSource,
} from "./api";

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

/**
 * "Market videos" — latest clips from the configured YouTube sources (CNBC
 * Television by default; add your own channels). Clicking a thumbnail plays the
 * clip inline via YouTube's embed.
 */
export function CnbcVideos() {
  const [videos, setVideos] = useState<CnbcVideo[]>([]);
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [active, setActive] = useState<CnbcVideo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  const load = (force = false) =>
    getCnbcVideos(force)
      .then((v) => live.current && setVideos(v))
      .catch(() => {});

  useEffect(() => {
    live.current = true;
    load().finally(() => live.current && setReady(true));
    getVideoSources().then((s) => live.current && setSources(s)).catch(() => {});
    const id = setInterval(() => load(), 5 * 60 * 1000); // refresh ~every 5 min
    return () => {
      live.current = false;
      clearInterval(id);
    };
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      if (live.current) setRefreshing(false);
    }
  };

  async function submitSource(e: FormEvent) {
    e.preventDefault();
    const url = input.trim();
    if (!url) return;
    setAdding(true);
    setError(null);
    try {
      setSources(await addVideoSource(url));
      setInput("");
      await load(true); // re-fetch with the new source included
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that source");
    } finally {
      setAdding(false);
    }
  }

  async function dropSource(channelId: string) {
    try {
      setSources(await removeVideoSource(channelId));
      await load(true);
    } catch {
      /* ignore */
    }
  }

  if (!ready && !videos.length) return null;

  return (
    <div className="insight-card">
      <div className="insight-head">
        <div>
          <h3>Market videos</h3>
          <div className="subtitle">
            {sources.length
              ? `Latest from ${sources.map((s) => s.label).join(", ")}`
              : "Add a YouTube channel to see its latest clips."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {active && (
            <button className="btn-ghost btn-sm" onClick={() => setActive(null)}>
              ✕ Close
            </button>
          )}
          <button
            className={`btn-ghost btn-sm${editing ? " active" : ""}`}
            onClick={() => setEditing((v) => !v)}
            title="Manage video sources"
          >
            Sources
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={refresh}
            disabled={refreshing}
            title="Fetch the latest videos now"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {refreshing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : "↻"} Refresh
          </button>
        </div>
      </div>

      {editing && (
        <div className="vsrc-editor">
          <div className="vsrc-list">
            {sources.map((s) => (
              <span key={s.channelId} className="vsrc-chip">
                {s.label}
                <button
                  className="vsrc-x"
                  aria-label={`Remove ${s.label}`}
                  onClick={() => dropSource(s.channelId)}
                >
                  ×
                </button>
              </span>
            ))}
            {sources.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No sources yet.</span>}
          </div>
          <form className="vsrc-add" onSubmit={submitSource}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="YouTube channel URL, @handle, or channel ID"
              spellCheck={false}
              autoComplete="off"
            />
            <button className="btn-primary btn-sm" disabled={adding || !input.trim()}>
              {adding ? "Adding…" : "Add"}
            </button>
          </form>
          {error && (
            <div className="banner banner-error" role="alert" style={{ margin: "0 18px 12px" }}>
              {error}
            </div>
          )}
        </div>
      )}

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

      {videos.length ? (
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
              <span className="cnbc-time">
                {v.source ? `${v.source} · ` : ""}
                {ago(v.published)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="insight-foot" style={{ padding: "16px 18px", textAlign: "left" }}>
          {sources.length
            ? "No videos yet — try Refresh."
            : "No video sources. Open Sources to add a YouTube channel."}
        </div>
      )}
    </div>
  );
}
