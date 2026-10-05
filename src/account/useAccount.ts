/** The signed-in state, asked once on load and again whenever the window
 *  gets focus (a sign-in in another tab shows up on return). Never blocks
 *  the first render: until the platform answers, the state is `unavailable`
 *  and nothing is shown. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kontoBase, me, signOut, type Konto, type MeState } from "./konto";

const BASE = kontoBase(import.meta.env?.VITE_KONTO_URL as string | undefined);

export function useAccount(): { konto: Konto | null; account: MeState; signOut: () => void } {
  const konto = useMemo<Konto | null>(() => (BASE ? { base: BASE, fetch: (...a) => fetch(...a) } : null), []);
  const [account, setAccount] = useState<MeState>({ kind: "unavailable" });
  // Answers can arrive out of order (load, then a quick focus): the last
  // asked wins.
  const asked = useRef(0);

  const check = useCallback(() => {
    if (!konto) return;
    const n = ++asked.current;
    void me(konto).then((state) => {
      if (n === asked.current) setAccount(state);
    });
  }, [konto]);

  useEffect(() => {
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [check]);

  const out = useCallback(() => {
    if (!konto) return;
    void signOut(konto).then(() => check());
  }, [konto, check]);

  return { konto, account, signOut: out };
}
