import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import API from "../services/api";
import logo from '/premier-icon.png';
import bgImage from '/blue_background.png';

// Staff roles selectable from the login dropdown. Customer login is kept
// completely separate (a single "Shop Name" field) since a customer
// account can never collide with a staff role.
const STAFF_ROLES = [
  { value: "end_user",    label: "End User" },
  { value: "admin",       label: "Admin" },
  { value: "system_admin",label: "System Admin" },
  { value: "super_admin", label: "Super Admin" },
];

const ROLE_HOME = {
  super_admin:  "/dashboard",
  system_admin: "/dashboard",
  admin:        "/dashboard",
  end_user:     "/end-user/dashboard",
  customer:     "/customer/dashboard",
};

export default function Login() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState(searchParams.get("mode") === "staff" ? "staff" : "customer");
  const [selectedRole, setSelectedRole] = useState(
    STAFF_ROLES.some((r) => r.value === searchParams.get("role")) ? searchParams.get("role") : STAFF_ROLES[0].value
  );

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);
  const navigate = useNavigate();

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setIdentifier("");
    setPassword("");
    setShowPassword(false);
  };

  const handleLogin = async () => {
    setError("");
    if (!identifier || !password) { setError("Please enter your credentials."); return; }
    setLoading(true);
    try {
      const res = await API.post("/login", { identifier, password });
      const { token, role } = res.data;

      // The role actually comes back from the server (each account has
      // exactly one role) — the dropdown/tab is the person's own
      // declaration of who they are, so if it doesn't match the account
      // that just authenticated, stop them here rather than silently
      // dropping them into a portal they didn't mean to open.
      const expectedRole = mode === "customer" ? "customer" : selectedRole;
      if (role !== expectedRole) {
        setError(`This login belongs to a different role (${roleLabel(role)}). Please select "${roleLabel(expectedRole)}" and try again, or switch tabs.`);
        setLoading(false);
        return;
      }

      localStorage.setItem("token", token);
      localStorage.setItem("role", role);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      // The account's own assigned District/Taluk (used to lock down which
      // customers an end_user/admin can view or create) lives on the User
      // row itself and comes back inside res.data.user — cache it under
      // its own keys too since several screens (EndUserLayout's area
      // badge, Add Customer's area lock, Quick Add) read it directly from
      // localStorage rather than re-parsing "user" every time.
      if (res.data.user?.Taluk)    localStorage.setItem("Taluk", JSON.stringify(res.data.user.Taluk));
      if (res.data.user?.District) localStorage.setItem("District", JSON.stringify(res.data.user.District));

      navigate(ROLE_HOME[role] || "/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleLogin(); };

  return (
    <div style={styles.page}>
      <div style={styles.bgImage} />

      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoWrap}>
          <img src={logo} alt="Premier Mills" style={styles.logo} />
        </div>

        {/* ── Customer / Staff mode switch ── */}
        <div style={styles.modeSwitch}>
          <button
            type="button"
            style={styles.modeBtn(mode === "customer")}
            onClick={() => switchMode("customer")}
          >
            Customer
          </button>
          <button
            type="button"
            style={styles.modeBtn(mode === "staff")}
            onClick={() => switchMode("staff")}
          >
            Staff Login
          </button>
        </div>

        {/* ── Role dropdown, staff mode only ── */}
        {mode === "staff" && (
          <div style={styles.inputWrap}>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              style={styles.select}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <span style={styles.inputIcon}><ChevronIcon /></span>
          </div>
        )}

        {error && (
          <div style={styles.errorBox}>
            <AlertIcon /><span>{error}</span>
          </div>
        )}

        {/* Identifier input */}
        <div style={styles.inputWrap}>
          <input
            type="text"
            placeholder={mode === "customer" ? "Shop Name" : "Username / Email / Phone"}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={handleKeyDown}
            style={styles.input}
            autoComplete="username"
          />
          <span style={styles.inputIcon}><UserIcon /></span>
        </div>

        {/* Password input */}
        <div style={styles.inputWrap}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ ...styles.input, paddingRight: 44 }}
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((p) => !p)}
            style={styles.eyeBtn}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{ ...styles.btn, ...(loading ? styles.btnDisabled : {}) }}
        >
          {loading ? "Signing in…" : "Login"}
        </button>

        <p style={styles.footerText}>Premier Mills Group · Premier CRM</p>
      </div>
    </div>
  );
}

function roleLabel(role) {
  if (role === "customer") return "Customer";
  const found = STAFF_ROLES.find((r) => r.value === role);
  return found ? found.label : role;
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10.5-8-10.5-8a19.7 19.7 0 0 1 4.19-5.19M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10.5 8 10.5 8a19.5 19.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B23A3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

const styles = {
  page: {
    minHeight: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    fontFamily: "'Inter', -apple-system, sans-serif",
  },

  bgImage: {
    position: "absolute",
    inset: 0,
    backgroundImage: `url(${bgImage})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    zIndex: 0,
  },
 card: {
  position: "relative",
  zIndex: 2,
  background: "rgba(255, 255, 255, 0.72)",
  backdropFilter: "blur(2px)",
  WebkitBackdropFilter: "blur(2px)",
  border: "1px solid rgba(255, 255, 255, 0.50)",
  borderRadius: 16,
  padding: "24px 40px 28px",  // reduced top padding
  width: 340,                  // narrower card
  boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
},

logoWrap: {
  display: "flex",
  justifyContent: "center",
  marginBottom: 16,
  marginTop: 0,
},

logo: {
  width: 220,   // smaller logo to reduce card height
  height: 100,
  objectFit: "contain",
},

modeSwitch: {
  display: "flex",
  gap: 6,
  background: "rgba(0,0,0,0.05)",
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: 9,
  padding: 4,
  marginBottom: 14,
},

modeBtn: (active) => ({
  flex: 1,
  padding: "8px 0",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: "0.02em",
  background: active ? "#1F5C99" : "transparent",
  color: active ? "#fff" : "#556",
  boxShadow: active ? "0 2px 8px rgba(74,144,184,0.35)" : "none",
  transition: "all 0.15s",
}),

select: {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.90)",
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 8,
  padding: "12px 44px 12px 16px",
  fontSize: 14,
  color: "#333",
  fontFamily: "inherit",
  outline: "none",
  appearance: "none",
  cursor: "pointer",
},

inputWrap: {
  position: "relative",
  marginBottom: 12,
},

input: {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.90)",
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 8,
  padding: "12px 44px 12px 16px",
  fontSize: 14,
  color: "#333",
  fontFamily: "inherit",
  outline: "none",
},

btn: {
  width: "100%",
  padding: "12px 0",
  background: "#24a822",
  border: "none",
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 600,
  color: "#fff",
  fontFamily: "inherit",
  cursor: "pointer",
  marginTop: 4,
  letterSpacing: "0.03em",
  transition: "opacity 0.2s",
},

  errorBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(178,58,58,0.08)",
    border: "1px solid rgba(178,58,58,0.25)",
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 14,
    fontSize: 13,
    color: "#B23A3A",
  },



  inputIcon: {
    position: "absolute",
    right: 14,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#888",
    display: "flex",
    alignItems: "center",
    pointerEvents: "none",
  },

  eyeBtn: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    padding: 0,
    background: "transparent",
    border: "none",
    borderRadius: 6,
    color: "#777",
    cursor: "pointer",
  },

 

  btnDisabled: { opacity: 0.6, cursor: "not-allowed" },

  footerText: {
    textAlign: "center",
    fontSize: 11,
    color: "#888",
    margin: "20px 0 0",
    letterSpacing: "0.04em",
  },
};