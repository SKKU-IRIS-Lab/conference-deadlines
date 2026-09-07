import type { ReactNode } from "react"
import { BRAND } from "../brand"
import { Icon } from "./Icons"
import type { CatalogView } from "./Primitives"

const irisLogo = new URL("../iris-logo.png", import.meta.url).href

interface NavigationProps {
  readonly theme: "light" | "dark"
  readonly onToggleTheme: () => void
}

interface SiteNavigationProps extends NavigationProps {
  readonly exploreHref: string
  readonly manageHref: string
  readonly productHref: string
  readonly onNavigateView: (view: CatalogView) => void
}

interface HeroProps {
  readonly children: ReactNode
  readonly id: string
  readonly lastUpdated: string | undefined
}

export function Hero({ children, id, lastUpdated }: HeroProps) {
  return (
    <section className="hero" id={id}>
      <div className="hero__inner">
        <p className="hero__badge">
          <Icon name="check" /> Trusted research deadline tracker
        </p>
        <h1 className="sr-only">IRIS Conference Deadline 학회 일정</h1>
        {children}
        <section aria-label="데이터 신뢰도 요약" className="trust-strip">
          <span>
            <Icon name="clock" /> Last updated{" "}
            {lastUpdated ? (
              <time dateTime={lastUpdated}>{lastUpdated.slice(0, 10).replaceAll("-", ".")}</time>
            ) : (
              <span>—</span>
            )}
          </span>
        </section>
      </div>
    </section>
  )
}

export function ErrorState({ message }: { readonly message: string }) {
  return (
    <div className="error-state" role="alert">
      <span className="error-state__icon">
        <Icon name="clock" />
      </span>
      <strong>데이터를 불러오지 못했습니다</strong>
      <span>{message}</span>
      <button onClick={() => window.location.reload()} type="button">
        다시 시도
      </button>
    </div>
  )
}

function Brand({ exploreHref }: { readonly exploreHref: string }) {
  return (
    <a aria-label={`${BRAND.name} 홈`} className="brand" href={exploreHref}>
      <img className="brand-mark" src={irisLogo} alt="" width={36} height={36} />
      <span className="brand-copy">
        <strong>{BRAND.name}</strong>
        <small>{BRAND.tagline}</small>
      </span>
    </a>
  )
}

function ThemeToggle({ theme, onToggleTheme }: NavigationProps) {
  const isDark = theme === "dark"
  return (
    <button
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      aria-pressed={isDark}
      className="theme-toggle"
      onClick={onToggleTheme}
      type="button"
    >
      <Icon name={isDark ? "sun" : "moon"} />
      <span>{isDark ? "Light" : "Dark"}</span>
    </button>
  )
}

export function SiteNavigation({
  theme,
  onToggleTheme,
  exploreHref,
  productHref,
  manageHref,
  onNavigateView,
}: SiteNavigationProps) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Brand exploreHref={exploreHref} />
        <nav aria-label="주요 메뉴" className="primary-nav">
          <a href={exploreHref}>Explore</a>
          <a href={productHref} onClick={() => onNavigateView("timeline")}>
            Timeline
          </a>
          <a href={productHref} onClick={() => onNavigateView("calendar")}>
            Calendar
          </a>
          <a href={manageHref}>Manage</a>
        </nav>
        <div className="header-tools">
          <ThemeToggle onToggleTheme={onToggleTheme} theme={theme} />
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer>
      <div className="footer__identity">
        <strong>{BRAND.tagline}</strong>
        <span>Official sources · Verified deadlines · Change history</span>
      </div>
      <p className="curation-note">
        연구실 Timeline 108개 항목의 분류를 반영했습니다.
        <a
          aria-label="연구실 Timeline 원본 열기"
          href="https://verbena-heat-9b5.notion.site/Timeline-f8bcc599203845ccbbbfcae6e6dd7fca?pvs=73"
          rel="noreferrer"
          target="_blank"
        >
          Data source <Icon name="source" />
        </a>
      </p>
    </footer>
  )
}
