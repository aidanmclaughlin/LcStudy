"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { ProgressDashboardStats } from "@/lib/progress-stats";
import type { CurrentGamePoint } from "../public/legacy/js/modules/journey.mjs";

const Dashboard = dynamic(() => import("./stats-dashboard").then(module => module.StatsDashboard), {
  ssr: false,
  loading: () => <div className="stats-empty" role="status">Loading progress...</div>
});

export function StatsView({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<ProgressDashboardStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [currentGame, setCurrentGame] = useState<CurrentGamePoint | null>(null);

  useEffect(() => {
    const update = (event: Event) => setCurrentGame((event as CustomEvent<CurrentGamePoint | null>).detail);
    window.addEventListener("lcstudy:current-game", update);
    return () => window.removeEventListener("lcstudy:current-game", update);
  }, []);

  useEffect(() => {
    const sync = () => {
      const visible = window.location.hash === "#stats";
      if (visible && !dialog.current?.open) dialog.current?.showModal();
      if (!visible && dialog.current?.open) dialog.current.close();
      setOpen(visible);
      window.dispatchEvent(new CustomEvent("lcstudy:stats-visibility", { detail: { open: visible } }));
      if (!visible) trigger.current?.focus({ preventScroll: true });
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    if (window.location.hash === "#stats") sync();
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
      window.dispatchEvent(new CustomEvent("lcstudy:stats-visibility", { detail: { open: false } }));
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/v1/progress", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 401 ? "Your sign-in has expired." : "Progress could not be loaded.");
        const result = await response.json();
        if (!controller.signal.aborted) setStats(result);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); document.body.style.overflow = previous; };
  }, [open, revision]);

  function show() {
    history.pushState({ ...history.state, lcstudyStats: true }, "", "#stats");
    dialog.current?.showModal();
    setOpen(true);
    window.dispatchEvent(new CustomEvent("lcstudy:stats-visibility", { detail: { open: true } }));
  }

  function close() {
    if (history.state?.lcstudyStats) history.back();
    else {
      history.replaceState(history.state, "", window.location.pathname + window.location.search);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }

  return <>
    <button ref={trigger} type="button" className="panel panel-stats stats-trigger" onClick={show}
      aria-label="Accuracy summary, open statistics" aria-haspopup="dialog" aria-controls="stats-dialog" aria-expanded={open}
      title="View progress statistics">
      {children}<ChevronRight className="stats-trigger-chevron" size={14} aria-hidden="true" />
    </button>
    <dialog ref={dialog} id="stats-dialog" className="stats-dialog" aria-label="Progress statistics" onCancel={event => { event.preventDefault(); close(); }}>
      {open && <>
        <div className="stats-dialog-bar">
          <button type="button" className="stats-back" onClick={close} autoFocus><ArrowLeft size={16} aria-hidden="true" />Resume game</button>
          <span className="sr-only">Game paused</span>
          {loading && <span className="stats-refreshing" role="status">Updating...</span>}
        </div>
        {error ? <div className="stats-load-state" role="alert"><p>{error}</p><button type="button" className="btn stats-back" onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Retry</button></div>
          : stats ? <Dashboard stats={stats} embedded currentGame={currentGame} /> : <div className="stats-load-state" role="status">Loading progress...</div>}
      </>}
    </dialog>
  </>;
}
