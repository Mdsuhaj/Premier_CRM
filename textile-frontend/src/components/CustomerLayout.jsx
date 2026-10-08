// src/components/CustomerLayout.jsx
//
// Dedicated layout for the "customer" role. Reuses the same Header and
// Footer as the internal admin Layout for visual consistency, but ships a
// deliberately small, routed sidebar — Dashboard, Shop, and My Orders are
// separate pages under /customer/*.
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import { useTheme } from "../ThemeContext";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export default function CustomerLayout({ children, pageTitle }) {
  const { colors, isDark } = useTheme();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  // Sidebar open/close toggle — persisted so it stays collapsed/expanded
  // across page navigations (each page remounts this layout on route change).
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("sidebarOpen") !== "false");
  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      localStorage.setItem("sidebarOpen", String(!prev));
      return !prev;
    });
  };

  const isDashboard = location.pathname === "/customer/dashboard";
  const isProductCatalog = location.pathname.startsWith("/customer/catalog");
  const isDrafts = location.pathname.startsWith("/customer/drafts");
  const isOrderEnquiry = location.pathname.startsWith("/customer/enquiry");
  const isOrders = location.pathname.startsWith("/customer/orders");
  const isTrackOrders = location.pathname.startsWith("/customer/track");
  const isRaiseComplaint = location.pathname.startsWith("/customer/complaints");
  const isNotifications = location.pathname.startsWith("/customer/notifications");

  const S = buildStyles(colors, isDark);

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={S.body}>

        {/* ── Sidebar (customer-scoped) ── */}
        <div style={{ ...S.sidebar, width: sidebarOpen ? S.sidebar.width : 0, minWidth: sidebarOpen ? S.sidebar.width : 0, padding: sidebarOpen ? S.sidebar.padding : "20px 0px", overflow: sidebarOpen ? "auto" : "hidden", transition: "width 0.25s ease, min-width 0.25s ease, padding 0.25s ease" }}>
          <div style={S.logoWrap}>
            <span style={S.logoText}>Premier CRM</span>
          </div>

          <div style={S.welcomeBadge}>
            {user.name || user.email || "Customer"}
          </div>

          <nav style={S.nav}>
            <Link to="/customer/dashboard" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isDashboard ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><GridIcon /></span>
                <span>Dashboard</span>
              </div>
            </Link>
            <Link to="/customer/catalog" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isProductCatalog ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><ActivityIcon /></span>
                <span>Product Selection</span>
              </div>
            </Link>

            <Link to="/customer/drafts" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isDrafts ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><LayersIcon /></span>
                <span>Drafts</span>
              </div>
            </Link>

            <Link to="/customer/enquiry" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isOrderEnquiry ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><ShopIcon /></span>
                <span>Order Enquiry</span>
              </div>
            </Link>

            <Link to="/customer/orders" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isOrders ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><OrdersIcon /></span>
                <span>My Orders</span>
              </div>
            </Link>
            {/* <Link to="/customer/track" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isTrackOrders ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><CategoryIcon/></span>
                <span>Tracking</span>
              </div>
            </Link> */}
            <Link to="/customer/notifications" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isNotifications ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><BellNavIcon /></span>
                <span>Notifications</span>
              </div>
            </Link>
            <Link to="/customer/complaints" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isRaiseComplaint ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><ChartIcon /></span>
                <span>Complaint Raise</span>
              </div>
            </Link>
          </nav>

          <div style={S.sidebarFooterNote}>
            Need help? Contact your Premier CRM representative.
          </div>
        </div>

        {/* ── Right: Header + Scrollable Content + Footer ── */}
        <div style={S.rightPane}>
          <Header sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} pageTitle={pageTitle} />
          <div style={S.scrollArea}>
            <div style={S.main}>{children}</div>
            <Footer />
          </div>
        </div>
      </div>
    </div>
  );
}

function buildStyles(colors, isDark) {
  return {
    page: {
      display: "flex",
      height: "100%",
      overflow: "hidden",
      background: colors.background,
      fontFamily: FONT,
    },
    body: {
      display: "flex",
      flex: 1,
      minHeight: 0,
      overflow: "hidden",
    },
    rightPane: {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      minHeight: 0,
      overflow: "hidden",
    },
    scrollArea: {
      flex: 1,
      overflowY: "auto",
      overflowX: "hidden",
    },
    main: {
      padding: "12px 20px 24px",
      background: isDark ? colors.background : "#F5F7FA",
      backgroundImage: isDark ? "none" : "radial-gradient(circle at 1px 1px, rgba(15,33,56,0.05) 1px, transparent 0), radial-gradient(1200px 500px at 100% -10%, rgba(31,92,153,0.07), transparent 60%)",
      backgroundSize: "22px 22px, 100% 100%",
      backgroundAttachment: "fixed, fixed",
      minHeight: "calc(100% - 46px)",
    },
    sidebar: {
      width: 190,
      background: colors.sidebarBg,
      display: "flex",
      flexDirection: "column",
      padding: "20px 10px",
      flexShrink: 0,
      overflowY: "auto",
    },
    logoWrap: {
      display: "flex", alignItems: "center", gap: 9,
      paddingLeft: 6, marginBottom: 14,
    },
    logoText: {
      fontFamily: "\'Space Grotesk\', " + FONT,
      fontSize: 16, fontWeight: 700, color: "#ffffff", letterSpacing: "-0.3px",
    },
    welcomeBadge: {
      fontSize: 12, color: "rgba(255,255,255,0.60)",
      marginLeft: 4, marginBottom: 18,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    },
    nav: { flex: 1 },
    navItem: {
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px", borderRadius: 8, marginBottom: 2,
      cursor: "pointer", fontSize: 14,
      color: "rgb(255, 255, 255)", transition: "all 0.15s",
      fontFamily: FONT,
    },
    navItemActive: {
      background: colors.sidebarActive,
      color: "#ffffff", fontWeight: 600,
      borderLeft: "3px solid #D69426",
    },
    navIcon: { display: "flex", alignItems: "center", color: "inherit" },
    sidebarFooterNote: {
      fontSize: 11, color: "rgb(255, 255, 255)",
      lineHeight: 1.5, padding: "12px 10px 4px",
      borderTop: "1px solid rgba(255,255,255,0.08)",
    },
  };
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function ShopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1.5-5h15L21 9" /><path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
      <path d="M9 13a3 3 0 0 0 6 0" />
    </svg>
  );
}
function OrdersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3H8a2 2 0 0 0-2 2v16l6-3 6 3V5a2 2 0 0 0-2-2z" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
function CategoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 10h16M4 14h8M4 18h8" />
      <circle cx="19" cy="16" r="3" />
      <path d="M19 13v3l2 1" />
    </svg>
  );
}
function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}