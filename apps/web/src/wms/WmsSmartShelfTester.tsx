import { useMemo, useState } from "react";
import { Lightbulb, LightbulbOff, Send, PackagePlus, PackageMinus, Tag, PlayCircle, Wifi, WifiOff, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  SmartShelfClient,
  ShelfApiError,
  createMockShelfServer,
  type ShelfApiResponse,
  type ShelfOutApiResponse,
  type ShelfOutColor,
  type ShelfRecord,
  type ShelfSlot,
  type MockShelfState,
} from "../../../../integrations/smart-shelf/src";

type Status = "idle" | "sending" | "ok" | "ng" | "error";

type CardState = {
  status: Status;
  request: unknown;
  response: unknown;
  durationMs?: number;
  errorMessage?: string;
};

const initial: CardState = { status: "idle", request: null, response: null };

// Helper to copy a `MockShelfState` shallowly for stable rendering
function snapshotMock(s: MockShelfState) {
  return {
    shelves: Array.from(s.shelves.values()).map((sh: ShelfRecord) => ({
      code: sh.code,
      lightOn: sh.lightOn,
      lightColor: sh.lightColor,
      slots: sh.slots.map((slot: ShelfSlot) => ({ labelId: slot.labelId, locationCode: slot.locationCode })),
    })),
    removedLabels: [...s.removedLabels],
  };
}

export function WmsSmartShelfTester({ locale }: { locale: Locale }) {
  // Connection
  const [baseUrl, setBaseUrl] = useState("http://192.168.1.10:8093");
  const [useMock, setUseMock] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [connStatus, setConnStatus] = useState<"idle" | "checking" | "ok" | "down">("idle");

  // Mock state (lives for the page lifetime)
  const [mock] = useState(() => createMockShelfServer());
  const [mockSnapshot, setMockSnapshot] = useState(() => snapshotMock(mock.state));

  // LightOnAllEmptyLocation form
  const [lightShelfCode, setLightShelfCode] = useState("L001A");
  const [lightColor, setLightColor] = useState<0 | 1>(1);

  // ShelfIn form
  const [inLabelId, setInLabelId] = useState("TSN0001");
  const [inShelfCode, setInShelfCode] = useState("L001A");
  const [inMaterialCode, setInMaterialCode] = useState("CS001");
  const [inQty, setInQty] = useState(100);

  // ShelfOut form
  const [outList, setOutList] = useState("TSN0001,TSN0002");
  const [outColor, setOutColor] = useState<ShelfOutColor>(3);

  // InventoryRemoveLable form
  const [rmLabelId, setRmLabelId] = useState("TSN0001");

  // Per-card result state
  const [lightCard, setLightCard] = useState<CardState>(initial);
  const [inCard, setInCard] = useState<CardState>(initial);
  const [outCard, setOutCard] = useState<CardState>(initial);
  const [rmCard, setRmCard] = useState<CardState>(initial);

  const client = useMemo(() => {
    return new SmartShelfClient({
      baseUrl,
      timeoutMs,
      fetchImpl: useMock ? mock.fetch : undefined,
    });
  }, [baseUrl, timeoutMs, useMock, mock]);

  function snapshotMockState() {
    setMockSnapshot(snapshotMock(mock.state));
  }

  async function healthCheck() {
    setConnStatus("checking");
    try {
      // No real health endpoint per spec — ping by issuing an empty color:0 call to a known shelf
      await client.lightOnAllEmptyLocation({ shelfCode: "L001A", color: 0 });
      setConnStatus("ok");
    } catch (err: unknown) {
      // 300/400 still means the device answered; "network error:..." means unreachable
      if (err instanceof ShelfApiError && (err.code === "300" || err.code === "400" || err.code === "OK")) {
        setConnStatus("ok");
      } else {
        setConnStatus("down");
      }
    }
  }

  function resetMock() {
    mock.reset();
    snapshotMockState();
    setLightCard(initial);
    setInCard(initial);
    setOutCard(initial);
    setRmCard(initial);
  }

  async function callApi<TReq, TRes extends ShelfApiResponse>(
    setter: (s: CardState) => void,
    endpoint: string,
    body: TReq,
    fn: (req: TReq) => Promise<TRes>,
  ) {
    setter({ status: "sending", request: { endpoint, body }, response: null });
    const start = performance.now();
    try {
      const res = await fn(body);
      setter({
        status: "ok",
        request: { endpoint, body },
        response: res,
        durationMs: Math.round(performance.now() - start),
      });
      snapshotMockState();
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - start);
      if (err instanceof ShelfApiError) {
        setter({
          status: "ng",
          request: { endpoint, body },
          response: { Result: "NG", ErrorCode: err.code, Message: err.message },
          durationMs,
          errorMessage: err.message,
        });
      } else {
        setter({
          status: "error",
          request: { endpoint, body },
          response: null,
          durationMs,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      snapshotMockState();
    }
  }

  async function runAll() {
    await callApi(setLightCard, "/api/shelf/LightOnAllEmptyLocation", { shelfCode: lightShelfCode, color: lightColor }, (b) =>
      client.lightOnAllEmptyLocation(b),
    );
    await callApi(setInCard, "/api/shelf/ShelfIn", { labelId: inLabelId, shelfCode: inShelfCode, materialCode: inMaterialCode, qty: inQty }, (b) =>
      client.shelfIn(b),
    );
    const outLabels = outList.split(",").map((s) => s.trim()).filter(Boolean);
    await callApi(setOutCard, "/api/shelf/ShelfOut", { labelIdList: outLabels, color: outColor }, (b) =>
      client.shelfOut(b) as Promise<ShelfOutApiResponse>,
    );
    await callApi(setRmCard, "/api/shelf/InventoryRemoveLable", { labelId: rmLabelId }, (b) =>
      client.inventoryRemoveLable(b),
    );
  }

  return (
    <div className="screen-stack">
      {/* Connection panel */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("shelf.title", locale)}</h2>
            <p>{t("shelf.subtitle", locale)}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ConnBadge status={connStatus} locale={locale} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto auto", gap: 12, alignItems: "end" }}>
          <Field label={t("shelf.connection", locale)}>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t("shelf.placeholder.url", locale)}
              disabled={useMock}
              style={inputStyle}
            />
          </Field>
          <Field label={t("shelf.timeout", locale)}>
            <input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value) || 5000)}
              style={inputStyle}
              min={100}
            />
          </Field>
          <Field label={t("shelf.useMock", locale)}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={useMock}
                onChange={(e) => setUseMock(e.target.checked)}
              />
              <span style={{ fontSize: 13 }}>Mock (in-process)</span>
            </label>
          </Field>
          <button type="button" className="action-button" onClick={healthCheck} title={t("shelf.healthCheck", locale)}>
            <Wifi size={16} />
            {t("shelf.healthCheck", locale)}
          </button>
          <button type="button" className="action-button" onClick={runAll} title={t("shelf.runAll", locale)}>
            <PlayCircle size={16} />
            {t("shelf.runAll", locale)}
          </button>
        </div>

        {useMock && (
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>
              Mock state ({mockSnapshot.shelves.length} shelves, {mockSnapshot.removedLabels.length} removed) — click to view
            </summary>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="action-button" onClick={resetMock} style={{ marginBottom: 8 }}>
                <RotateCcw size={14} />
                Reset Mock
              </button>
              <pre style={preStyle}>{JSON.stringify(mockSnapshot, null, 2)}</pre>
            </div>
          </details>
        )}
      </section>

      {/* API 1: LightOnAllEmptyLocation */}
      <ApiCard
        title={t("shelf.api.light.title", locale)}
        icon={lightColor === 1 ? <Lightbulb size={18} /> : <LightbulbOff size={18} />}
        card={lightCard}
        locale={locale}
        onSend={() =>
          callApi(setLightCard, "/api/shelf/LightOnAllEmptyLocation", { shelfCode: lightShelfCode, color: lightColor }, (b) =>
            client.lightOnAllEmptyLocation(b),
          )
        }
        form={
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={t("shelf.field.shelfCode", locale)}>
              <input
                value={lightShelfCode}
                onChange={(e) => setLightShelfCode(e.target.value)}
                placeholder={t("shelf.placeholder.shelfCode", locale)}
                style={inputStyle}
              />
            </Field>
            <Field label={t("shelf.field.color", locale)}>
              <select value={lightColor} onChange={(e) => setLightColor(Number(e.target.value) as 0 | 1)} style={inputStyle}>
                <option key="light-red" value={0}>{t("shelf.color.0", locale)}</option>
                <option key="light-green" value={1}>{t("shelf.color.1", locale)}</option>
              </select>
            </Field>
          </div>
        }
      />

      {/* API 2: ShelfIn */}
      <ApiCard
        title={t("shelf.api.shelfIn.title", locale)}
        icon={<PackagePlus size={18} />}
        card={inCard}
        locale={locale}
        onSend={() =>
          callApi(setInCard, "/api/shelf/ShelfIn", { labelId: inLabelId, shelfCode: inShelfCode, materialCode: inMaterialCode, qty: inQty }, (b) =>
            client.shelfIn(b),
          )
        }
        form={
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <Field label={t("shelf.field.labelId", locale)}>
              <input
                value={inLabelId}
                onChange={(e) => setInLabelId(e.target.value)}
                placeholder={t("shelf.placeholder.labelId", locale)}
                style={inputStyle}
              />
            </Field>
            <Field label={t("shelf.field.shelfCode", locale)}>
              <input
                value={inShelfCode}
                onChange={(e) => setInShelfCode(e.target.value)}
                placeholder={t("shelf.placeholder.shelfCode", locale)}
                style={inputStyle}
              />
            </Field>
            <Field label={t("shelf.field.materialCode", locale)}>
              <input
                value={inMaterialCode}
                onChange={(e) => setInMaterialCode(e.target.value)}
                placeholder={t("shelf.placeholder.materialCode", locale)}
                style={inputStyle}
              />
            </Field>
            <Field label={t("shelf.field.qty", locale)}>
              <input
                type="number"
                value={inQty}
                onChange={(e) => setInQty(Number(e.target.value) || 0)}
                style={inputStyle}
              />
            </Field>
          </div>
        }
      />

      {/* API 3: ShelfOut */}
      <ApiCard
        title={t("shelf.api.shelfOut.title", locale)}
        icon={<PackageMinus size={18} />}
        card={outCard}
        locale={locale}
        onSend={() => {
          const labelIdList = outList.split(",").map((s) => s.trim()).filter(Boolean);
          callApi(
            setOutCard,
            "/api/shelf/ShelfOut",
            { labelIdList, color: outColor },
            (b) => client.shelfOut(b) as Promise<ShelfOutApiResponse>,
          );
        }}
        form={
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <Field label={t("shelf.field.labelIdList", locale)}>
              <input
                value={outList}
                onChange={(e) => setOutList(e.target.value)}
                placeholder={t("shelf.placeholder.labelIdList", locale)}
                style={inputStyle}
              />
            </Field>
            <Field label={t("shelf.field.color", locale)}>
              <select
                value={outColor}
                onChange={(e) => setOutColor(Number(e.target.value) as ShelfOutColor)}
                style={inputStyle}
              >
                <option key="out-off" value={3}>{t("shelf.color.3", locale)}</option>
                <option key="out-red" value={4}>{t("shelf.color.4", locale)}</option>
                <option key="out-green" value={5}>{t("shelf.color.5", locale)}</option>
                <option key="out-blue" value={6}>{t("shelf.color.6", locale)}</option>
                <option key="out-yellow" value={7}>{t("shelf.color.7", locale)}</option>
                <option key="out-default" value={0}>{t("shelf.color.0", locale)}</option>
              </select>
            </Field>
          </div>
        }
      />

      {/* API 4: InventoryRemoveLable */}
      <ApiCard
        title={t("shelf.api.removeLable.title", locale)}
        icon={<Tag size={18} />}
        card={rmCard}
        locale={locale}
        onSend={() =>
          callApi(setRmCard, "/api/shelf/InventoryRemoveLable", { labelId: rmLabelId }, (b) =>
            client.inventoryRemoveLable(b),
          )
        }
        form={
          <Field label={t("shelf.field.labelId", locale)}>
            <input
              value={rmLabelId}
              onChange={(e) => setRmLabelId(e.target.value)}
              placeholder={t("shelf.placeholder.labelId", locale)}
              style={inputStyle}
            />
          </Field>
        }
      />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ApiCard({
  title,
  icon,
  card,
  locale,
  onSend,
  form,
}: {
  title: string;
  icon: React.ReactNode;
  card: CardState;
  locale: Locale;
  onSend: () => void;
  form: React.ReactNode;
}) {
  const sending = card.status === "sending";
  return (
    <section className="surface-panel">
      <div className="section-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon}
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
        </div>
        <StatusBadge status={card.status} locale={locale} durationMs={card.durationMs} />
      </div>
      <div style={{ marginTop: 12 }}>{form}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" className="action-button" onClick={onSend} disabled={sending}>
          <Send size={14} />
          {sending ? t("shelf.sending", locale) : t("shelf.send", locale)}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <div style={labelStyle}>{t("shelf.request", locale)}</div>
          <pre style={preStyle}>{card.request ? JSON.stringify(card.request, null, 2) : "—"}</pre>
        </div>
        <div>
          <div style={labelStyle}>{t("shelf.response", locale)}</div>
          <pre style={preStyle}>
            {card.errorMessage && card.status === "error"
              ? `ERROR: ${card.errorMessage}`
              : card.response
                ? JSON.stringify(card.response, null, 2)
                : "—"}
          </pre>
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ status, locale, durationMs }: { status: Status; locale: Locale; durationMs?: number }) {
  const map: Record<Status, { tone: string; labelKey: string }> = {
    idle: { tone: "muted", labelKey: "shelf.status.idle" },
    sending: { tone: "info", labelKey: "shelf.sending" },
    ok: { tone: "ok", labelKey: "shelf.status.ok" },
    ng: { tone: "danger", labelKey: "shelf.status.ng" },
    error: { tone: "danger", labelKey: "shelf.status.error" },
  };
  const m = map[status];
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <span
        style={{
          padding: "2px 8px",
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 600,
          background:
            m.tone === "ok"
              ? "var(--ok-bg)"
              : m.tone === "danger"
                ? "var(--danger-bg)"
                : m.tone === "info"
                  ? "var(--info-bg, rgba(56,132,255,0.15))"
                  : "var(--muted-bg, rgba(120,120,120,0.15))",
          color: m.tone === "ok" ? "var(--ok)" : m.tone === "danger" ? "var(--danger)" : m.tone === "info" ? "var(--info)" : "var(--muted)",
        }}
      >
        {t(m.labelKey, locale)}
      </span>
      {durationMs !== undefined && <span style={{ fontSize: 12, color: "var(--muted)" }}>{durationMs}ms</span>}
    </span>
  );
}

function ConnBadge({ status, locale }: { status: "idle" | "checking" | "ok" | "down"; locale: Locale }) {
  if (status === "idle") {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "var(--muted)", fontSize: 13 }}>
        <WifiOff size={14} />
        {t("shelf.disconnected", locale)}
      </span>
    );
  }
  if (status === "checking") {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "var(--info)", fontSize: 13 }}>
        <Wifi size={14} />
        {t("shelf.checking", locale)}
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "var(--ok)", fontSize: 13 }}>
        <Wifi size={14} />
        {t("shelf.connected", locale)}
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "var(--danger)", fontSize: 13 }}>
      <WifiOff size={14} />
      {t("shelf.disconnected", locale)}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  height: 38,
  padding: "0 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 12,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "var(--text)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 240,
  overflow: "auto",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
};
