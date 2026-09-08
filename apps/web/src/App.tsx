import type { Edition, Evidence, History } from "@conf/contracts"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { getCatalogLastUpdated, getEditionBundle, getEditions } from "./api"
import { AdminPanel } from "./components/AdminPanel"
import { CatalogControls, ProductHeader } from "./components/CatalogControls"
import { ChatWidget } from "./components/ChatWidget"
import { FIELD_CATEGORY_ORDER } from "./components/category-tone"
import { EditionResults } from "./components/EditionResults"
import { EvidencePanel } from "./components/EvidencePanel"
import { filterEditions, upcomingEditions } from "./components/edition-dates"
import { ErrorState, Hero, SiteFooter, SiteNavigation } from "./components/PageChrome"
import { type CatalogView, PrimitiveShowcase } from "./components/Primitives"

const THEME_STORAGE_KEY = "conference-atlas-theme"

function initialTheme(): "light" | "dark" {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === "light" || stored === "dark") return stored
  return "light"
}

export function App() {
  const mainId = useId()
  const exploreId = useId()
  const productId = useId()
  const productTitleId = useId()
  const listPanelId = useId()
  const timelinePanelId = useId()
  const calendarPanelId = useId()
  const managementId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const [editions, setEditions] = useState<readonly Edition[]>([])
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("전체")
  const [view, setView] = useState<CatalogView>("timeline")
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme)
  const [selected, setSelected] = useState<Edition>()
  const [evidence, setEvidence] = useState<readonly Evidence[]>([])
  const [history, setHistory] = useState<readonly History[]>([])
  const [lastUpdated, setLastUpdated] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [compact, setCompact] = useState(false)
  const [managementPage, setManagementPage] = useState(() => window.location.hash === "#/manage")

  useEffect(() => {
    const update = () => setManagementPage(window.location.hash === "#/manage")
    window.addEventListener("hashchange", update)
    return () => window.removeEventListener("hashchange", update)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    Promise.all([getEditions(), getCatalogLastUpdated().catch(() => undefined)])
      .then(([nextEditions, nextLastUpdated]) => {
        setEditions(nextEditions)
        setLastUpdated(nextLastUpdated)
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "알 수 없는 오류가 발생했습니다."),
      )
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener("keydown", focusSearch)
    return () => document.removeEventListener("keydown", focusSearch)
  }, [])

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const media = window.matchMedia("(max-width: 1279px)")
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (!compact || !selected) return
    const previousOverflow = document.body.style.overflow
    const previousFocus = triggerRef.current
    const panel = document.querySelector<HTMLElement>(".evidence-panel")
    const background = document.querySelectorAll<HTMLElement>(
      ".site-header, .hero, .product-header, .results-column, footer",
    )
    const focusable = () =>
      panel?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(undefined)
        return
      }
      if (event.key !== "Tab") return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.body.style.overflow = "hidden"
    for (const element of background) element.inert = true
    panel?.querySelector<HTMLButtonElement>(".panel-close")?.focus()
    document.addEventListener("keydown", containFocus)
    return () => {
      document.body.style.overflow = previousOverflow
      for (const element of background) element.inert = false
      document.removeEventListener("keydown", containFocus)
      previousFocus?.focus()
    }
  }, [compact, selected])

  const currentEditions = useMemo(() => upcomingEditions(editions, new Date()), [editions])
  const categories = useMemo(() => {
    const available = new Set(currentEditions.flatMap((edition) => edition.categories))
    const labCategories = FIELD_CATEGORY_ORDER.filter((item) => available.has(item))
    const otherCategories = [...available]
      .filter((item) => !FIELD_CATEGORY_ORDER.some((labCategory) => labCategory === item))
      .sort((left, right) => left.localeCompare(right, "ko"))
    return ["전체", ...labCategories, ...otherCategories]
  }, [currentEditions])
  const filtered = useMemo(
    () => filterEditions(currentEditions, query, category),
    [category, currentEditions, query],
  )

  async function selectEdition(editionId: string) {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setLoading(true)
    try {
      const bundle = await getEditionBundle(editionId)
      setSelected(bundle.edition)
      setEvidence(bundle.evidence)
      setHistory(bundle.history)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "상세 정보를 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }

  if (window.location.pathname === "/dev/primitives") return <PrimitiveShowcase />

  return (
    <div className="app-shell">
      <a className="skip-link" href={`#${mainId}`}>
        본문으로 건너뛰기
      </a>
      <SiteNavigation
        exploreHref={`#${exploreId}`}
        manageHref="#/manage"
        onNavigateView={setView}
        onToggleTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
        productHref={`#${productId}`}
        theme={theme}
      />
      <main id={mainId}>
        {managementPage ? (
          <AdminPanel editions={editions} id={managementId} />
        ) : (
          <>
            <Hero id={exploreId} lastUpdated={lastUpdated}>
              <CatalogControls
                onQueryChange={(nextQuery) => {
                  setQuery(nextQuery)
                  setSelected(undefined)
                }}
                query={query}
                searchRef={searchRef}
              />
            </Hero>
            <section aria-labelledby={productTitleId} className="product-shell" id={productId}>
              <ProductHeader
                calendarPanelId={calendarPanelId}
                categories={categories}
                category={category}
                count={filtered.length}
                headingId={productTitleId}
                listPanelId={listPanelId}
                onCategoryChange={(nextCategory) => {
                  setCategory(nextCategory)
                  setSelected(undefined)
                }}
                onViewChange={setView}
                timelinePanelId={timelinePanelId}
                view={view}
              />
              {error ? (
                <ErrorState message={error} />
              ) : (
                <div
                  className="catalog-layout"
                  data-has-selection={Boolean(selected)}
                  data-view={view}
                >
                  <section
                    aria-busy={loading}
                    aria-label="학회 일정 검색 결과"
                    aria-labelledby={`${view === "list" ? listPanelId : view === "timeline" ? timelinePanelId : calendarPanelId}-tab`}
                    className="results-column"
                    id={
                      view === "list"
                        ? listPanelId
                        : view === "timeline"
                          ? timelinePanelId
                          : calendarPanelId
                    }
                    role="tabpanel"
                  >
                    <div className="results-head">
                      <p>
                        <strong>{filtered.length}</strong> curated schedules
                      </p>
                    </div>
                    {loading && editions.length === 0 ? (
                      <output className="skeleton-list">일정을 불러오는 중...</output>
                    ) : (
                      <EditionResults
                        editions={filtered}
                        groupByCategory={category === "전체"}
                        onSelect={selectEdition}
                        selectedId={selected?.id}
                        view={view}
                      />
                    )}
                  </section>
                  {compact && selected ? (
                    <button
                      aria-label="상세 닫기"
                      className="evidence-scrim"
                      onClick={() => setSelected(undefined)}
                      tabIndex={-1}
                      type="button"
                    />
                  ) : null}
                  <EvidencePanel
                    compact={compact}
                    edition={selected}
                    evidence={evidence}
                    history={history}
                    loading={loading && Boolean(selected)}
                    onClose={() => setSelected(undefined)}
                  />
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <SiteFooter />
      {!(compact && selected) ? <ChatWidget /> : null}
    </div>
  )
}
