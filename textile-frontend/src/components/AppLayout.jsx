// src/components/AppLayout.jsx
//
// Some pages (Order List, Add Order) are shared between staff roles
// (super_admin/system_admin/admin) and end_user, but each role should see
// a different sidebar shell around the same content. This picks the right
// one based on the logged-in role, so those pages don't need to duplicate
// themselves.
import Layout from "./Layout";
import EndUserLayout from "./EndUserLayout";

export default function AppLayout({ children, ...props }) {
  const role = localStorage.getItem("role");

  if (role === "end_user") {
    return <EndUserLayout pageTitle={props.pageTitle}>{children}</EndUserLayout>;
  }

  return <Layout {...props}>{children}</Layout>;
}