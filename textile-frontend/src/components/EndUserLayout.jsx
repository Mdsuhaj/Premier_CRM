// src/components/EndUserLayout.jsx
//
// Dedicated layout for the "end_user" role (area/taluk-scoped field
// officer). Mirrors CustomerLayout's small, focused sidebar rather than
// the full admin Layout — an end_user doesn't manage system-wide master
// data, so they don't need that whole menu tree.
//
// Nav:
//   Dashboard          -> /end-user/dashboard
//   Product Selection  -> /end-user/product-selection (its own top-level
//                          link, right under Dashboard — it's the single
//                          most-used screen for a field officer, so it no
//                          longer sits buried inside a dropdown)
//   Customers           -> Add Customer (/end-user/customers/add) + Customer List (/end-user/customers)
//   Enquiry Order        -> Order Enquired (/master/enquiry) + Drafts
//                          (/end-user/drafts) + My Orders (/master/orders,
//                          default tab) + Customer Orders
//                          (/master/orders?tab=customer). "My Orders" and
//                          "Customer Orders" used to be in-page tabs on
//                          one Order List screen — they're now their own
//                          sidebar entries so each is a distinct,
//                          bookmarkable page instead of two sub-pages
//                          hiding inside one.
//   Complaints          -> /end-user/complaints (read-only, area-wide complaints)
//
// NOTE: /master/orders itself still needs to read the `tab` query param
// (default "mine", or "customer") to pick which list it renders, and its
// old in-page "My Orders"/"Customer Orders" toggle buttons can come out
// now that the sidebar drives that instead. That page wasn't provided
// here, so this file only does the sidebar-side half of the split.
//
// A field officer's cart-to-order lifecycle: build a cart in Product
// Selection, optionally park it in Drafts instead of submitting, submit
// it (from Cart Checkout, reached via Product Selection's "View Cart &
// Submit") which lands it as a pending enquiry (Order Enquired), then
// track it in My Orders — alongside every order placed by their
// customers, in Customer Orders.
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import { useTheme } from "../ThemeContext";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export default function EndUserLayout({ children, pageTitle }) {
  const { colors, isDark } = useTheme();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const taluks = readTaluks();

  const isDashboard = location.pathname === "/end-user/dashboard";
  const isNewOrder = location.pathname === "/master/orders/add";
  const isOrdersPage = location.pathname.startsWith("/master/orders") && !isNewOrder;
  // "My Orders" is the default tab on /master/orders — anything other
  // than an explicit ?tab=customer counts as My Orders being active.
  const isCustomerOrders = isOrdersPage && searchParams.get("tab") === "customer";
  const isMyOrders = isOrdersPage && !isCustomerOrders;
  const isEnquiry = location.pathname.startsWith("/master/enquiry");
  const isProductSelection = location.pathname === "/end-user/product-selection";
  const isCartCheckout = location.pathname === "/end-user/order-cart";
  const isDrafts = location.pathname === "/end-user/drafts";
  const isComplaints = location.pathname.startsWith("/end-user/complaints");
  const isNotifications = location.pathname.startsWith("/end-user/notifications");
  const isAddCustomer = location.pathname === "/end-user/customers/add";
  const isCustomerList = location.pathname === "/end-user/customers";

  // "Enquiry Order" group — everything in the enquiry-to-order lifecycle:
  // Order Enquired, Drafts, My Orders, Customer Orders. Product Selection
  // lives outside this group as its own top-level link (see nav below).
  const [enquiryOpen, setEnquiryOpen] = useState(isEnquiry || isDrafts || isCartCheckout || isOrdersPage);
  const [customersOpen, setCustomersOpen] = useState(isAddCustomer || isCustomerList);
  // Sidebar open/close toggle — persisted so it stays collapsed/expanded
  // across page navigations (each page remounts this layout on route change).
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("sidebarOpen") !== "false");
  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      localStorage.setItem("sidebarOpen", String(!prev));
      return !prev;
    });
  };

  const S = buildStyles(colors, isDark);

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={S.body}>

        {/* ── Sidebar (end_user / area-scoped) ── */}
        <div style={{ ...S.sidebar, width: sidebarOpen ? S.sidebar.width : 0, minWidth: sidebarOpen ? S.sidebar.width : 0, padding: sidebarOpen ? S.sidebar.padding : "20px 0px", overflow: sidebarOpen ? "auto" : "hidden", transition: "width 0.25s ease, min-width 0.25s ease, padding 0.25s ease" }}>
          <div style={S.logoWrap}>
            <span style={S.logoText}>Premier CRM</span>
          </div>

          {/* <div style={S.welcomeBadge}>
             {user.name || user.email || "End User"}
          </div> */}

          {/* {taluks.length > 0 && (
            <div style={S.areaBadge}>
               {taluks.join(", ")}
              <span style={{ opacity: 0.6 }}> (Taluk)</span>
            </div>
          )} */}

          <nav style={S.nav}>
            <Link to="/end-user/dashboard" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isDashboard ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><GridIcon /></span>
                <span>Dashboard</span>
              </div>
            </Link>

            <Link to="/end-user/product-selection" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isProductSelection ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><ProductIcon /></span>
                <span>Product Selection</span>
              </div>
            </Link>

            {/* <div style={S.navGroup}>
              <div style={S.navGroupHeader} onClick={() => setCustomersOpen(!customersOpen)}>
                <span style={S.navIcon}><UsersIcon /></span>
                <span style={S.navGroupLabel}>Customers</span>
                <span style={{ ...S.chevron, transform: customersOpen ? "rotate(90deg)" : "rotate(0deg)" }}><ChevronIcon /></span>
              </div>
              {customersOpen && (
                <div style={S.navGroupBody}>
                  <NavLeaf to="/end-user/customers/add" label="Add Customer" active={isAddCustomer} S={S} />
                  <NavLeaf to="/end-user/customers" label="Customer List" active={isCustomerList} S={S} />
                </div>
              )}
            </div> */}

            <div style={S.navGroup}>
              <div style={S.navGroupHeader} onClick={() => setEnquiryOpen(!enquiryOpen)}>
                <span style={S.navIcon}><OrdersIcon /></span>
                <span style={S.navGroupLabel}>Enquiry Order</span>
                <span style={{ ...S.chevron, transform: enquiryOpen ? "rotate(90deg)" : "rotate(0deg)" }}><ChevronIcon /></span>
              </div>
              {enquiryOpen && (
                <div style={S.navGroupBody}>
                  <NavLeaf to="/end-user/drafts" label="Drafts" active={isDrafts} S={S} />
                  <NavLeaf to="/master/orders" label="My Orders" active={isMyOrders} S={S} />
                  <NavLeaf to="/master/orders?tab=customer" label="Customer Orders" active={isCustomerOrders} S={S} />
                </div>
              )}
            </div>

            <Link to="/end-user/notifications" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isNotifications ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><BellNavIcon /></span>
                <span>Notifications</span>
              </div>
            </Link>

            <Link to="/end-user/complaints" style={{ textDecoration: "none" }}>
              <div style={{ ...S.navItem, ...(isComplaints ? S.navItemActive : {}) }}>
                <span style={S.navIcon}><ChartIcon /></span>
                <span>Complaints & Claims</span>
              </div>
            </Link>
          </nav>

          <div style={S.sidebarFooterNote}>
            Need help? Contact your District Admin.
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

// Taluk is stored as a JSON array (or a plain string, for older records).
// Normalise either shape into a clean string array for display.
// Taluk may be stored as a JSON array, a JSON-encoded string containing
// another JSON array (double-encoded), or a plain legacy string. Keep
// decoding until it resolves to an array or a non-JSON plain value.
function readTaluks() {
  const raw = localStorage.getItem("Taluk") || localStorage.getItem("assignedArea") || "";
  return parseAreaList(raw);
}

function parseAreaList(raw) {
  let value = raw;
  for (let i = 0; i < 3 && typeof value === "string" && value !== ""; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      break; // not (further) JSON — stop, treat current value as final
    }
  }
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value) return [String(value)];
  return [];
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
      width: 200,
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
      marginLeft: 4, marginBottom: 6,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    },
    areaBadge: {
      fontSize: 11, color: "rgba(255,255,255,0.55)",
      marginLeft: 4, marginBottom: 16,
    },
    nav: { flex: 1 },
    navItem: {
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px", borderRadius: 8, marginBottom: 2,
      cursor: "pointer", fontSize: 14,
      color: "rgba(255, 255, 255, 0.96)", transition: "all 0.15s",
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
      color: "rgba(255, 255, 255, 0.96)", transition: "all 0.15s",
      fontFamily: FONT,
    },
    navGroupLabel: { flex: 1, fontWeight: 500 },
    chevron: {
      display: "flex", alignItems: "center",
      color: "rgba(255, 255, 255, 0.97)", transition: "transform 0.15s",
    },
    navGroupBody: { paddingLeft: 12, marginTop: 2, marginBottom: 4 },
    navLeafItem: {
      padding: "8px 12px", fontSize: 12.5,
      color: "rgba(255, 255, 255, 0.94)", cursor: "pointer",
      borderRadius: 6, transition: "all 0.15s", fontFamily: FONT,
    },
    navLeafActive: {
      background: "rgba(91,155,217,0.20)",
      color: "#ffffff", fontWeight: 600,
      borderLeft: "2px solid #D69426",
    },
    sidebarFooterNote: {
      fontSize: 11, color: "rgba(255,255,255,0.40)",
      lineHeight: 1.5, padding: "12px 10px 4px",
      borderTop: "1px solid rgba(255,255,255,0.08)",
    },
  };
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

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function ProductIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41 13.41 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
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
function ChevronIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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