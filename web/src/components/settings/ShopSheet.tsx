// Connect Shopify or WooCommerce (CONNECTORS.md §2): a tab each; the shop address, the token or the key and secret
// (password fields, never shown again; a saved one shows its hint, an environment variable locks the field and names
// itself), the four-step test, the history, then Connect. Opened with ?connect=shopify or ?connect=woocommerce.
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { LockIcon } from "lucide-react";
import { useAppState, useCall } from "@/api/queries";
import type { ConnectorSecret, ConnectorTest, ConnStep } from "@/api/types";
import { SegmentedControl } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmt, useT } from "@/i18n";
import { describeError } from "@/lib/errors";
import { useFormat } from "@/lib/format";
import { ConnSteps, useConnectedToast, useOnOpen, useStepReveal } from "./Connectors";

const IDS = ["reach", "scope", "orders", "range"];
type Shop = "shopify" | "woocommerce";

function SecretNote({ secret }: { secret: ConnectorSecret | null | undefined }) {
  const t = useT();
  if (!secret?.set) return null;
  if (secret.locked)
    return (
      <p className="flex items-start gap-1.5 text-2xs text-text-muted">
        <LockIcon size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
        {fmt(t.set.env_lock, { variable: secret.env ?? "" })}
      </p>
    );
  return <p className="text-2xs text-text-muted">{fmt(t.sources.saved_secret, { hint: secret.hint ?? "" })}</p>;
}

export function ShopSheet() {
  const t = useT();
  const f = useFormat();
  const call = useCall();
  const { data: state } = useAppState();
  const connectedToast = useConnectedToast();
  const [params, setParams] = useSearchParams();
  const param = params.get("connect");
  const open = param === "shopify" || param === "woocommerce";
  const [tab, setTab] = useState<Shop>("shopify");
  const [shop, setShop] = useState("");
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [history, setHistory] = useState<90 | 400>(90);
  const [test, setTest] = useState<ConnectorTest | null>(null);
  const [tested, setTested] = useState("");
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { shown, setShown, reveal } = useStepReveal();
  const hostRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const conn = (id: Shop) => state?.connectors.find((c) => c.id === id);
  useOnOpen(open, () => {
    setTab(param === "woocommerce" ? "woocommerce" : "shopify");
    setShop(conn("shopify")?.target ?? "");
    setUrl(conn("woocommerce")?.target ?? "");
    setToken("");
    setKey("");
    setSecret("");
    setTest(null);
    setShown([]);
    setFailure(null);
  });
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("connect");
    setParams(next);
  };
  const switchTab = (v: Shop) => {
    setTab(v);
    setTest(null);
    setShown([]);
    setFailure(null);
  };

  const current = tab === "shopify" ? conn("shopify") : conn("woocommerce");
  const sec = current?.secret;
  // A saved or env-set secret may be left empty: the server uses the one it has.
  const haveSecret = !!sec?.set;
  const values = tab === "shopify" ? { shop: shop.trim(), token: token.trim() || undefined } : { url: url.trim(), key: key.trim() || undefined, secret: secret.trim() || undefined };
  const sig = JSON.stringify([tab, values]);
  const stale = !!test && tested !== sig;
  const passed = !!test?.ok && !stale && !testing;
  const ready = tab === "shopify" ? !!shop.trim() && (haveSecret || !!token.trim()) : !!url.trim() && (haveSecret || (!!key.trim() && !!secret.trim()));
  const name = tab === "shopify" ? t.sources.shop.shopify : t.sources.shop.woocommerce;

  const run = async () => {
    setTesting(true);
    setFailure(null);
    setShown([]);
    try {
      const r = tab === "shopify" ? await call("test_shopify", { shop: shop.trim(), token: token.trim() || undefined }) : await call("test_woocommerce", { url: url.trim(), key: key.trim() || undefined, secret: secret.trim() || undefined });
      setTest(r);
      setTested(sig);
      await reveal(r.steps);
    } catch (e) {
      setFailure(describeError(t, e, f.bytes));
    } finally {
      setTesting(false);
    }
  };
  const connect = async () => {
    if (!test) return;
    setBusy(true);
    try {
      if (tab === "shopify") await call("connect_shopify", { test_id: test.test_id, history_days: history });
      else await call("connect_woocommerce", { test_id: test.test_id, history_days: history });
      await connectedToast(name);
      close();
    } catch (e) {
      setFailure(describeError(t, e, f.bytes));
    } finally {
      setBusy(false);
    }
  };
  const done = (step: ConnStep) => {
    const d = step.detail ?? {};
    const D = t.sources.shop.done;
    switch (step.id) {
      case "reach":
        return fmt(D.reach, { host: String(d.host ?? "") });
      case "scope":
        return fmt(D.scope, { scopes: String(d.scopes ?? "") });
      case "orders":
        return fmt(D.orders, { date: f.date(String(d.date ?? ""), true), orders: f.int(Number(d.orders ?? 0)) });
      case "range":
        return fmt(D.range, { from: f.date(String(d.from ?? ""), true), to: f.date(String(d.to ?? ""), true) });
      default:
        return step.id;
    }
  };
  const field = "font-mono";
  const label = "text-2xs font-medium text-text-muted";
  const hint = "text-2xs text-text-subtle";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-base font-semibold">{t.sources.shop.title}</SheetTitle>
          <SheetDescription>{t.sources.shop.lead}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Tabs value={tab} onValueChange={(v) => switchTab(v as Shop)}>
            <TabsList>
              <TabsTrigger value="shopify">{t.sources.shop.shopify}</TabsTrigger>
              <TabsTrigger value="woocommerce">{t.sources.shop.woocommerce}</TabsTrigger>
            </TabsList>
          </Tabs>
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!testing && ready) void run();
            }}
          >
            {tab === "shopify" ? (
              <>
                <div className="flex flex-col gap-1">
                  <label htmlFor="shop-domain" className={label}>
                    {t.sources.shop.shop}
                  </label>
                  <Input id="shop-domain" ref={hostRef} value={shop} onChange={(e) => setShop(e.target.value)} placeholder={t.sources.shop.shop_placeholder} className={field} autoComplete="off" spellCheck={false} />
                  <p className={hint}>{t.sources.shop.shop_hint}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="shop-token" className={label}>
                    {t.sources.shop.token}
                  </label>
                  <Input id="shop-token" ref={keyRef} type="password" value={token} disabled={!!sec?.locked} onChange={(e) => setToken(e.target.value)} className={field} autoComplete="off" spellCheck={false} />
                  <SecretNote secret={sec} />
                  <p className={hint}>{t.sources.shop.token_hint}</p>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <label htmlFor="woo-url" className={label}>
                    {t.sources.shop.url}
                  </label>
                  <Input id="woo-url" ref={hostRef} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.sources.shop.url_placeholder} className={field} autoComplete="off" spellCheck={false} />
                  <p className={hint}>{t.sources.shop.url_hint}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="woo-key" className={label}>
                      {t.sources.shop.key}
                    </label>
                    <Input id="woo-key" ref={keyRef} type="password" value={key} disabled={!!sec?.locked} onChange={(e) => setKey(e.target.value)} className={field} autoComplete="off" spellCheck={false} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="woo-secret" className={label}>
                      {t.sources.shop.secret}
                    </label>
                    <Input id="woo-secret" type="password" value={secret} disabled={!!sec?.locked} onChange={(e) => setSecret(e.target.value)} className={field} autoComplete="off" spellCheck={false} />
                  </div>
                </div>
                <SecretNote secret={sec} />
                <p className={hint}>{t.sources.shop.key_hint}</p>
              </>
            )}
            <div className="flex flex-col gap-1.5">
              <span className={label}>{t.sources.history.label}</span>
              <SegmentedControl
                label={t.sources.history.label}
                value={history}
                onChange={setHistory}
                options={[
                  { value: 90, label: t.sources.history.d90 },
                  { value: 400, label: t.sources.history.d400 },
                ]}
              />
            </div>
            <div>
              <Button type="submit" variant="outline" disabled={testing || !ready}>
                {testing && <Spinner data-icon="inline-start" />}
                {testing ? t.sources.testing : test ? t.sources.retest : t.sources.test}
              </Button>
              {failure && (
                <p className="mt-2 text-[13px] text-danger" role="alert">
                  {failure}
                </p>
              )}
            </div>
          </form>
          {(test || shown.length > 0) && (
            <div className="mt-5">
              <ConnSteps ids={IDS} names={t.sources.shop.steps} shown={shown} doneText={done} stale={stale} onFix={(st) => (st.id === "reach" ? hostRef : keyRef).current?.focus()} />
            </div>
          )}
        </div>
        <SheetFooter className="flex-col gap-3 border-t border-border sm:flex-col">
          <p className="text-2xs text-text-muted">{t.sources.privacy}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!passed && <span className="mr-auto text-2xs text-text-muted">{t.sources.test_first}</span>}
            <Button variant="ghost" onClick={close}>
              {t.common.cancel}
            </Button>
            <Button disabled={!passed || busy} onClick={() => void connect()}>
              {busy && <Spinner data-icon="inline-start" />}
              {fmt(t.sources.shop.connect, { name })}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
