import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import { useTheme } from "../ThemeContext";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// District/Taluk may be stored as a plain array, a JSON-encoded array
// string, or (due to a past double-encoding bug) a JSON string whose
// content is itself another JSON array. Keep decoding until it resolves
// to an array or a non-JSON plain value.
function parseAreaList(raw) {
  let value = raw;
  for (let i = 0; i < 3 && typeof value === "string" && value !== ""; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value) return [String(value)];
  return [];
}

/**
 * Role hierarchy (4 logins):
 *  - super_admin  : read-only everywhere
 *  - system_admin : full access; approves admin + end_user accounts
 *  - admin        : area-scoped operational access
 *  - end_user     : restricted, area-scoped menu
 *
 * Sidebar changes in this version:
 *  - The old "Master" group is now "Order Details".
 *  - The "Customer" sub-group (Add Customer / Customer List) is removed.
 *  - "Today's Orders" (the Order Details page, /master/sales-order) sits in
 *    that group next to "Order List" (all orders).
 *  - The separate top-level "Order Details" link and the "Expired Partials"
 *    link are gone (Expired Partials now lives inside Order Details >
 *    Pending Allocation).
 *  - Super Admin sees the group with just "Today's Orders", so what was
 *    visible to them before is unchanged.
 */
export default function Layout({ children, pageTitle, pageSubtitle }) {
  const location = useLocation();
  const { colors, isDark } = useTheme();
  const role = localStorage.getItem("role") || "super_admin";
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const district = parseAreaList(user.District || localStorage.getItem("District") || "").join(", ");
  const taluk = parseAreaList(user.Taluk || localStorage.getItem("Taluk") || "").join(", ");
  const assignedArea = user.AssignedArea || localStorage.getItem("assignedArea") || district || taluk || "";

  const isSuperAdmin = role === "super_admin";
  const isSystemAdmin = role === "system_admin";
  const isAdmin = role === "admin";
  const isEndUser = role === "end_user";

  // Each group only starts open if the current URL is inside it.
  const [detailsOpen, setDetailsOpen] = useState(
    () => location.pathname.startsWith("/master/sales-order")
      || location.pathname.startsWith("/master/orders")
      || location.pathname.startsWith("/master/enquiry")
  );
  const [reportsOpen, setReportsOpen] = useState(() => location.pathname.startsWith("/reports"));
  // Admin Master — Super Admin only.
  const [adminMasterOpen, setAdminMasterOpen] = useState(() => location.pathname.startsWith("/master/admin-master"));

  // Sidebar open/close toggle — persisted across page navigations.
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("sidebarOpen") !== "false");
  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      localStorage.setItem("sidebarOpen", String(!prev));
      return !prev;
    });
  };

  const isActive = (path) => location.pathname === path;
  const isPrefix = (path) => location.pathname.startsWith(path);

  const S = buildStyles(colors, isDark);

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={S.body}>

        {/* ── Sidebar ── */}
        <div style={{ ...S.sidebar, width: sidebarOpen ? S.sidebar.width : 0, minWidth: sidebarOpen ? S.sidebar.width : 0, padding: sidebarOpen ? S.sidebar.padding : "20px 0px", overflow: sidebarOpen ? "auto" : "hidden", transition: "width 0.25s ease, min-width 0.25s ease, padding 0.25s ease" }}>
          <div style={S.logoWrap}> <span style={S.logoText}>Premier CRM</span>
          </div>

          {/* {(isAdmin || isEndUser) && (assignedArea || district || taluk) && (
            <div style={S.areaBadge}>
              📍 {isAdmin ? (district || assignedArea) : (taluk || assignedArea)}
              {isAdmin && <span style={{ opacity: 0.6 }}> (District)</span>}
              {isEndUser && <span style={{ opacity: 0.6 }}> (Taluk)</span>}
            </div>
          )} */}

          <nav style={S.nav}>
            <Link to="/dashboard" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isActive("/dashboard") ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><GridIcon /></span>
                <span>Dashboard</span>
              </div>
            </Link>

            {/* Admin Master — Super Admin only. */}
            {isSuperAdmin && (
              <div style={S.navGroup}>
                <div style={S.navGroupHeader} onClick={() => setAdminMasterOpen(!adminMasterOpen)}>
                  <span style={S.navIcon}><ShieldIcon /></span>
                  <span style={S.navGroupLabel}>Admin Master</span>
                  <span style={{ ...S.chevron, transform: adminMasterOpen ? "rotate(90deg)" : "rotate(0deg)" }}><ChevronIcon /></span>
                </div>
                {adminMasterOpen && (
                  <div style={S.navGroupBody}>
                    <div style={S.navLeafGroup}>
                      <NavLeaf to="/master/admin-master/users" label="New User" active={isPrefix("/master/admin-master/users")} S={S} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Everything below is staff-only (hidden for end_user). */}
            {!isEndUser && (
              <>
                {/* Marketing Review — hidden for super_admin (still reachable by URL). */}
                {!isSuperAdmin && (
                  <Link to="/master/batches" style={{ textDecoration: "none" }}>
                    <div style={{ ...S.navItem, ...(isPrefix("/master/batches") ? S.navItemActive : {}) }}>
                      <span style={S.navIcon}><BoxIcon /></span>
                      <span>Marketing Review</span>
                    </div>
                  </Link>
                )}

                {/* Order Details (was "Master"):
                      Today's Orders -> the Order Details page, today's orders only
                      Order List     -> every order, all dates
                    Super Admin only gets Today's Orders. */}
                <div style={S.navGroup}>
                  <div style={S.navGroupHeader} onClick={() => setDetailsOpen(!detailsOpen)}>
                    <span style={S.navIcon}><LayersIcon /></span>
                    <span style={S.navGroupLabel}>Order Details</span>
                    <span style={{ ...S.chevron, transform: detailsOpen ? "rotate(90deg)" : "rotate(0deg)" }}><ChevronIcon /></span>
                  </div>
                  {detailsOpen && (
                    <div style={S.navGroupBody}>
                      <div style={S.navLeafGroup}>
                        <NavLeaf to="/master/sales-order" label="Today's Orders" active={isPrefix("/master/sales-order")} S={S} />
                        {!isSuperAdmin && (
                          <NavLeaf
                            to="/master/orders"
                            label="Order List"
                            active={isPrefix("/master/orders") || isPrefix("/master/enquiry")}
                            S={S}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* <Link to="/master/credit-limit" style={{ textDecoration: "none" }}>
                  <div style={{ ...S.navItem, ...(isPrefix("/master/credit-limit") ? S.navItemActive : {}) }}>
                    <span style={S.navIcon}><ReceiptIcon /></span>
                    <span>Credit Limit</span>
                  </div>
                </Link> */}
                <Link to="/master/claims" style={{ textDecoration: "none" }}>
                  <div style={{ ...S.navItem, ...(isPrefix("/master/claims") ? S.navItemActive : {}) }}>
                    <span style={S.navIcon}><FlagIcon /></span>
                    <span>Complaints & Claims</span>
                  </div>
                </Link>
              </>
            )}

            <Link to="/master/notifications" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isPrefix("/master/notifications") ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><BellNavIcon /></span>
                <span>Notifications</span>
              </div>
            </Link>

            {/* Reports — six report pages behind one collapsible group.
                Hidden for end_user. */}
            {!isEndUser && (
              <div style={S.navGroup}>
                <div style={S.navGroupHeader} onClick={() => setReportsOpen(!reportsOpen)}>
                  <span style={S.navIcon}><ChartIcon /></span>
                  <span style={S.navGroupLabel}>Reports</span>
                  <span style={{ ...S.chevron, transform: reportsOpen ? "rotate(90deg)" : "rotate(0deg)" }}><ChevronIcon /></span>
                </div>
                {reportsOpen && (
                  <div style={S.navGroupBody}>
                    <div style={S.navLeafGroup}>
                      <NavLeaf to="/reports/enquiry" label="Enquiry Order Report" active={isActive("/reports/enquiry")} S={S} />
                      <NavLeaf to="/reports/overdue" label="Overdue Report" active={isActive("/reports/overdue")} S={S} />
                      <NavLeaf to="/reports/data" label="Data Report" active={isActive("/reports/data")} S={S} />
                      <NavLeaf to="/reports/product-wise" label="Product Wise Report" active={isActive("/reports/product-wise")} S={S} />
                      <NavLeaf to="/reports/ageing" label="Ageing Report" active={isActive("/reports/ageing")} S={S} />
                      <NavLeaf to="/reports/sales-loss" label="Sales Loss Report" active={isActive("/reports/sales-loss")} S={S} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>

        {/* ── Right: Header + Scrollable Content + Footer ── */}
        <div style={S.rightPane}>
          <Header sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} pageTitle={pageTitle} />
          <div style={S.scrollArea}>
            <div style={S.main}>
              {children}
            </div>
            <Footer />
          </div>
        </div>
      </div>
    </div>
  );
}

function roleLabel(role) {
  switch (role) {
    case "super_admin": return "Super Admin";
    case "system_admin": return "System Admin";
    case "admin": return "Admin";
    case "end_user": return "End User";
    default: return role;
  }
}

function NavLeaf({ to, label, active, S }) {
  return (
    <Link to={to} style={{ textDecoration: "none" }}>
      <div style={{ ...S.navLeafItem, ...(active ? S.navLeafActive : {}) }}>
        {label}
      </div>
    </Link>
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
      padding: "24px 20px",
      background: isDark
        ? colors.background
        : "#F5F7FA",
      backgroundImage: isDark
        ? "none"
        : "radial-gradient(circle at 1px 1px, rgba(15,33,56,0.05) 1px, transparent 0), radial-gradient(1200px 500px at 100% -10%, rgba(31,92,153,0.07), transparent 60%)",
      backgroundSize: "22px 22px, 100% 100%",
      backgroundAttachment: "fixed, fixed",
      minHeight: "calc(100% - 46px)",
    },
    sidebar: {
      width: 210,
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
      fontFamily: "'Space Grotesk', " + FONT,
      fontSize: 16, fontWeight: 700, color: "#ffffff", letterSpacing: "-0.3px",
    },
    roleBadge: {
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 10px", marginBottom: 6, marginLeft: 4,
      borderRadius: 6, background: "rgba(255,255,255,0.08)",
      width: "fit-content",
    },
    roleBadgeText: {
      fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.80)",
      textTransform: "uppercase", letterSpacing: "0.04em",
    },
    roleBadgeTag: {
      fontSize: 9, fontWeight: 700, color: "#ffd166",
      background: "rgba(238,193,94,0.15)", padding: "2px 6px", borderRadius: 4,
      letterSpacing: "0.03em",
    },
    areaBadge: {
      fontSize: 11, color: "rgba(255,255,255,0.55)",
      marginLeft: 4, marginBottom: 16,
    },
    readOnlyBanner: {
      marginBottom: 18, padding: "10px 16px", borderRadius: 10,
      background: "rgba(238,193,94,0.12)", border: "1px solid rgba(238,193,94,0.35)",
      fontSize: 13, color: "#8A5A0E", fontFamily: FONT, fontWeight: 500,
    },
    nav: { flex: 1 },
    navItem: {
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px", borderRadius: 8, marginBottom: 2,
      cursor: "pointer", fontSize: 14,
      color: "rgba(255, 255, 255, 0.95)", transition: "all 0.15s",
      fontFamily: FONT,
    },
    navItemActive: {
      background: colors.sidebarActive,
      color: "#ffffff", fontWeight: 600,
      borderLeft: "3px solid #D69426",
    },
    navIcon: {
      display: "flex",
      alignItems: "center",
      color: "#ffffff",
    },
    navGroup: { marginBottom: 2 },
    navGroupHeader: {
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px", borderRadius: 8,
      cursor: "pointer", fontSize: 14,
      color: "rgba(244, 238, 238, 0.97)", transition: "all 0.15s",
      fontFamily: FONT,
    },
    navGroupLabel: { flex: 1, fontWeight: 500 },
    chevron: {
      display: "flex", alignItems: "center",
      color: "rgba(255, 255, 255, 0.95)", transition: "transform 0.15s",
    },
    navGroupBody: { paddingLeft: 12, marginTop: 2, marginBottom: 4 },
    navSubItem: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "9px 12px", fontSize: 13.5,
      color: "rgba(255, 255, 255, 0.93)", cursor: "pointer",
      borderRadius: 7, transition: "all 0.15s", fontFamily: FONT,
    },
    navSubActive: {
      background: colors.sidebarActive, color: "#ffffff", fontWeight: 600,
      borderLeft: "3px solid #D69426",
    },
    navLeafGroup: { paddingLeft: 12, marginBottom: 2 },
    navLeafItem: {
      padding: "8px 12px", fontSize: 12.5,
      color: "rgba(255, 255, 255, 0.92)", cursor: "pointer",
      borderRadius: 6, transition: "all 0.15s", fontFamily: FONT,
    },
    navLeafActive: {
      background: "rgba(91,155,217,0.20)",
      color: "#ffffff", fontWeight: 600,
      borderLeft: "2px solid #D69426",
    },
    pageHeader: { marginBottom: 24 },
    pageHeading: {
      fontFamily: "'Space Grotesk', " + FONT,
      fontSize: 26, fontWeight: 700, margin: "0 0 4px",
      color: colors.textPrimary, letterSpacing: "-0.4px",
    },
    pageHeadingSub: { fontSize: 13, color: colors.textSecondary, margin: 0, fontFamily: FONT },
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
function ChevronIcon({ small }) {
  const size = small ? 11 : 13;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
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
function BoxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" />
    </svg>
  );
}
function ReceiptIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z" /><line x1="8" y1="7" x2="16" y2="7" /><line x1="8" y1="11" x2="16" y2="11" />
    </svg>
  );
}
function FlagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
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