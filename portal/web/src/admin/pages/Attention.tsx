/* "What needs attention" board: each card is a link into the screen that fixes the problem. */
import { Link } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import { Button, ErrorCard, Skeleton } from "../../shared/ui";
import { IconRefresh } from "../../shared/icons";
import { relative } from "../../shared/format";
import { useAttention } from "../attention";
import { PageHead } from "../components";
import { useScope } from "../scope";

export default function Attention() {
  const { t, lang } = useI18n();
  const { items, loading, error, reload, loadedAt } = useAttention();
  const { siteId, siteName } = useScope();
  return (
    <>
      <PageHead title={t("attention.title")} sub={`${siteId ? siteName(siteId) : t("top.allSites")}${loadedAt ? ` · ${t("attention.updated", { time: relative(loadedAt, t, lang) })}` : ""}`}
        tools={<Button size="sm" onClick={reload} loading={loading}><IconRefresh size={16} />{t("attention.refresh")}</Button>} />
      {error && items.length === 0 ? <ErrorCard error={error} onRetry={reload} /> : null}
      {loading && items.length === 0 ? <div className="attention">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} block className="card" />)}</div> : null}
      {items.length ? (
        <div className="attention">
          {[...items].sort((a, b) => Number(b.count > 0) - Number(a.count > 0)).map((it) => (
            <Link key={it.kind} to={it.to} className={`card clickable ${it.count > 0 ? it.tone : "ok"}`} data-kind={it.kind}>
              <span className="big">{it.count}</span>
              <span className="lbl">{t(`attention.${it.kind}`)}</span>
              <span className="det">{it.count > 0 ? (it.detail || t(`attention.${it.kind}.hint`)) : t("attention.allClear")}</span>
              <span className="go">{t(`attention.${it.kind}.go`)} →</span>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}
