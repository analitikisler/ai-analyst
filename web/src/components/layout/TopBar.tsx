// The top bar's left slot belongs to the page (Overt's route `handle` pattern, done with a portal): Ask puts the
// conversations toggle and title there, Dashboards the period and compare selects, Checks the period.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SlotCtx = createContext<{ desktop: HTMLElement | null; phoneRow: HTMLElement | null; phoneActions: HTMLElement | null; setTitle: (t: string) => void } | null>(null);

export function TopBarSlotProvider({ desktop, phoneRow, phoneActions, setTitle, children }: { desktop: HTMLElement | null; phoneRow: HTMLElement | null; phoneActions: HTMLElement | null; setTitle: (t: string) => void; children: ReactNode }) {
  return <SlotCtx.Provider value={{ desktop, phoneRow, phoneActions, setTitle }}>{children}</SlotCtx.Provider>;
}

/** Renders `children` in the top bar (≥1024), `phone` in the row under the phone top bar and `phoneActions` as
 *  icon buttons in the phone top bar itself. */
export function TopBarContent({ children, phone, phoneActions }: { children?: ReactNode; phone?: ReactNode; phoneActions?: ReactNode }) {
  const ctx = useContext(SlotCtx);
  return (
    <>
      {ctx?.desktop && children ? createPortal(children, ctx.desktop) : null}
      {ctx?.phoneRow && phone ? createPortal(phone, ctx.phoneRow) : null}
      {ctx?.phoneActions && phoneActions ? createPortal(phoneActions, ctx.phoneActions) : null}
    </>
  );
}

/** The phone top bar shows the page title. */
export function usePhoneTitle(title: string) {
  const ctx = useContext(SlotCtx);
  useEffect(() => ctx?.setTitle(title), [ctx, title]);
}

export function useSlotNodes() {
  const [desktop, setDesktop] = useState<HTMLElement | null>(null);
  const [phoneRow, setPhoneRow] = useState<HTMLElement | null>(null);
  const [phoneActions, setPhoneActions] = useState<HTMLElement | null>(null);
  return { desktop, setDesktop, phoneRow, setPhoneRow, phoneActions, setPhoneActions };
}
