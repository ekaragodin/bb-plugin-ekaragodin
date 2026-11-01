import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useRpc, useSdk, useRealtime, useRealtimeConnectionState, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { titleSelectionSchema, titleContract } from "./title-contract";
import type { TitleActionController } from "./title-action";

type Selection = { providerId: string; model: string };
type Model = { id: string; label: string };
const controlStyle: CSSProperties = {
  width: "100%", minWidth: 0, padding: "8px 10px", borderRadius: 6,
  border: "1px solid var(--border, #888)", background: "var(--background, transparent)", color: "inherit",
};
const buttonStyle: CSSProperties = {
  padding: "7px 12px", borderRadius: 6, fontWeight: 500,
  border: "1px solid var(--border, #888)", background: "var(--background, transparent)", color: "inherit",
};

export function TitleSettings() {
  const rpc = useRpc<typeof titleContract>();
  const sdk = useSdk();
  const connection = useRealtimeConnectionState();
  const { data: view, error: loadError, isFetching: loading, refetch } = experimental_useRpcQuery({
    contract: titleContract, method: "titleSettings", input: null,
  });
  const [draft, setDraft] = useState<Selection>({ providerId: "", model: "" });
  const [catalog, setCatalog] = useState<{ key: string; models: Model[]; error: string | null; loading: boolean }>({
    key: "", models: [], error: null, loading: false,
  });
  const [reload, setReload] = useState(0);
  const refresh = () => { setReload(value => value + 1); void refetch(); };
  useRealtime("title-settings-changed", refresh);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = useRef(false);
  const pendingSave = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (view && !dirty.current) setDraft({ providerId: view.providerId, model: view.model });
  }, [view]);

  const selectedProvider = view?.providers.find(provider => provider.id === draft.providerId);
  const catalogKey = JSON.stringify([view?.hostId ?? null, draft.providerId]);
  useEffect(() => {
    let active = true;
    const hostId = view?.hostId;
    const providerId = draft.providerId;
    if (!hostId || !providerId || !selectedProvider?.available || !selectedProvider.supported) {
      setCatalog({ key: catalogKey, models: [], error: null, loading: false });
      return;
    }
    setCatalog({ key: catalogKey, models: [], error: null, loading: true });
    void sdk.providers.models({ hostId, providerId }).then(result => {
      if (!active) return;
      const models = result.models.map(model => ({ id: model.model, label: model.displayName }));
      const reason = result.modelLoadError ? "The model catalog is unavailable. The saved model is retained."
        : models.length === 0 ? "No models available. The saved model is retained." : null;
      setCatalog({ key: catalogKey, models, error: reason, loading: false });
    }, () => {
      if (active) setCatalog({ key: catalogKey, models: [], error: "Could not load models. The saved model is retained.", loading: false });
    });
    return () => { active = false; };
  }, [sdk, view?.hostId, draft.providerId, selectedProvider?.available, selectedProvider?.supported, catalogKey, connection, reload]);

  const currentCatalog = catalog.key === catalogKey ? catalog : { models: [], loading: true, error: null };
  const hasModel = currentCatalog.models.some(model => model.id === draft.model);
  const clearSelection = draft.providerId === "" && draft.model === "";
  const changed = view && (draft.providerId !== view.providerId || draft.model !== view.model);
  const canSave = !!changed && (clearSelection || (!!selectedProvider?.available && !!selectedProvider.supported && hasModel))
    && !currentCatalog.loading && !saving;

  const edit = (selection: Selection) => {
    dirty.current = true;
    setSaved(false);
    setError(null);
    setDraft(selection);
  };
  const save = async () => {
    if (!canSave || pendingSave.current) return;
    pendingSave.current = true;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await rpc.call("saveTitleSettings", titleSelectionSchema.parse(draft));
      if (!mounted.current) return;
      setDraft({ providerId: next.providerId, model: next.model });
      setSaved(true);
      await refetch();
      dirty.current = false;
    } catch {
      if (mounted.current) setError("Could not save title settings. Your selection is retained; try again.");
    } finally {
      pendingSave.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return <form onSubmit={event => { event.preventDefault(); void save(); }} style={{ maxWidth: "36rem", display: "grid", gap: 12 }}>
    <p style={{ margin: 0 }}>Choose the provider and small model used for titles in every thread.</p>
    <fieldset disabled={saving || !view} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 6 }} htmlFor="title-generation-provider">Title provider
        <select id="title-generation-provider" value={draft.providerId} style={controlStyle} onChange={event => {
          const id = event.target.value;
          const next = view?.providers.find(provider => provider.id === id);
          if (id === "" || (next?.supported && next.available)) edit({ providerId: id, model: "" });
        }}>
          <option value="">No title model selected</option>
          {draft.providerId && !view?.providers.some(provider => provider.id === draft.providerId)
            ? <option value={draft.providerId} disabled>{draft.providerId} (unavailable)</option> : null}
          {view?.providers.map(provider => <option key={provider.id} value={provider.id} disabled={!provider.supported || !provider.available}>
            {provider.label}{!provider.supported ? " — not supported" : !provider.available ? " — unavailable" : ""}
          </option>)}
        </select>
      </label>
      {selectedProvider?.reason ? <p style={{ margin: 0, fontSize: "0.875rem" }}>{selectedProvider.reason}</p> : null}
      <label style={{ display: "grid", gap: 6 }} htmlFor="title-generation-model">Title model
        <select id="title-generation-model" value={draft.model} disabled={!selectedProvider?.available || currentCatalog.loading} style={controlStyle} onChange={event => {
          const model = event.target.value;
          if (model === "" || currentCatalog.models.some(entry => entry.id === model)) edit({ ...draft, model });
        }}>
          <option value="">{currentCatalog.loading ? "Loading models…" : "Select a small model"}</option>
          {draft.model && !hasModel ? <option value={draft.model} disabled>{draft.model} (unavailable)</option> : null}
          {currentCatalog.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
      </label>
      {currentCatalog.error ? <p role="status" style={{ margin: 0, fontSize: "0.875rem" }}>{currentCatalog.error}</p> : null}
    </fieldset>
    {view?.reason ? <p style={{ margin: 0, fontSize: "0.875rem" }}>{view.reason}</p> : null}
    {error || loadError ? <p role="alert" style={{ margin: 0 }}>{error ?? "Could not load title settings. Try Refresh."}</p> : null}
    {saved ? <p role="status" style={{ margin: 0 }}>Title settings saved.</p> : null}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="submit" disabled={!canSave} style={{ ...buttonStyle, opacity: canSave ? 1 : 0.45 }}>{saving ? "Saving…" : "Save title settings"}</button>
      <button type="button" disabled={saving || loading} style={{ ...buttonStyle, opacity: saving || loading ? 0.45 : 1 }} onClick={refresh}>Refresh</button>
    </div>
  </form>;
}

export function TitleRefreshFeedback({ controller }: { controller: TitleActionController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    if (!snapshot.notice || snapshot.notice.error) return;
    const timer = setTimeout(controller.dismiss, 5000);
    return () => clearTimeout(timer);
  }, [controller, snapshot.notice]);
  if (!snapshot.notice && !snapshot.busy.size) return null;
  return <div role={snapshot.notice?.error ? "alert" : "status"} style={{
    position: "fixed", right: 16, bottom: 16, zIndex: 1000, width: "min(440px, calc(100vw - 32px))",
    padding: 14, borderRadius: 8, border: "1px solid var(--border, #888)",
    background: "var(--background, #222)", color: "var(--foreground, inherit)", boxShadow: "0 4px 18px #0003",
    display: "flex", gap: 12, alignItems: "start", overflowWrap: "anywhere",
  }}>
    <span style={{ flex: 1 }}>{snapshot.notice?.message ?? "Updating thread title…"}</span>
    {snapshot.notice ? <button type="button" aria-label="Dismiss title notification" onClick={controller.dismiss}>×</button> : null}
  </div>;
}
