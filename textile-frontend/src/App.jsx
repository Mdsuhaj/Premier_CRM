import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./ThemeContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CustomerDashboard from "./pages/CustomerDashboard";
import EndUserDashboard from "./pages/EndUserDashboard";
import ComplaintsAndClaims from "./pages/master/ComplaintsAndClaims";
import Allocation from "./pages/master/Allocation";
import Batches from "./pages/master/Batches";
import Invoices from "./pages/master/Invoices";
import ComplianceDashboard from "./pages/master/ComplianceDashboard";
import ProductCatalog from "./pages/ProductCatalog";
import CustomerDrafts from "./pages/CustomerDrafts";
import OrderEnquiry from "./pages/OrderEnquiry";
import StaffOrderEnquiry from "./pages/master/OrderEnquiry";
import CustomerOrders from "./pages/CustomerOrders";
import TrackOrders from "./pages/TrackOrders";
import RaiseComplaint from "./pages/RaiseComplaint";
import Notifications from "./pages/Notifications";
import SelectCategory from "./pages/SelectCategory";
import ProductList from "./pages/master/ProductList";
import AddProduct from "./pages/master/AddProduct";
import ProductView from "./pages/master/ProductView";
import CustomerList from "./pages/master/CustomerList";
import AddCustomer from "./pages/master/AddCustomer";
import CustomerView from "./pages/master/CustomerView";
import OrderList from "./pages/master/OrderList";
import AddOrder from "./pages/master/AddOrder";
import OrderView from "./pages/master/OrderView";
import AllocationEmployeeDirectory from "./pages/master/AllocationEmployeeDirectory";
import AllocationSystemAdmin from "./pages/master/AllocationSystemAdmin";
import AllocationAdminEndUsers from "./pages/master/AllocationAdminEndUsers";
import SalesOrder from "./pages/master/SalesOrder";
import ErpSaleOrders from "./pages/master/ErpSaleOrders";
import CreditLimit from "./pages/master/CreditLimit";
import AdminMasterUsers from "./pages/master/AdminMasterUsers";
import AdminMasterUserForm from "./pages/master/AdminMasterUserForm";
import EndUserAddCustomer from "./pages/end-user/AddCustomer";
import EndUserCustomerList from "./pages/end-user/CustomerList";
import EndUserProductSelection from "./pages/end-user/ProductSelection";
import Drafts from "./pages/end-user/Drafts";
import CartCheckout from "./pages/end-user/CartCheckout";
import EnquiryOrderReportPage from "./pages/reports/EnquiryOrderReportPage";
import OverdueReportPage from "./pages/reports/OverdueReportPage";
import DataReportPage from "./pages/reports/DataReportPage";
import ProductWiseReportPage from "./pages/reports/ProductWiseReportPage";
import AgeingReportPage from "./pages/reports/AgeingReportPage";
import SalesLossReportPage from "./pages/reports/SalesLossReportPage";
import AvailableStock from "./pages/master/AvailableStock";
import SaleLossList from "./pages/master/SaleLossList";
import RejectedList from "./pages/master/RejectedList";

function App() {
  const basename =
    import.meta.env.VITE_DEPLOY_TARGET === "vercel" ? "/" : "/Premier_crm/public";

  return (
    <ThemeProvider>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Customer journey:
              Dashboard -> Product Catalog (browse + specify color/size)
              -> Order Enquiry (review cart + submit) -> My Orders
              -> Track Orders (once dispatched) -> Raise Complaint */}
          <Route path="/customer/dashboard" element={<CustomerDashboard />} />
          <Route path="/customer/catalog" element={<ProductCatalog />} />
          <Route path="/customer/drafts" element={<CustomerDrafts />} />
          <Route path="/customer/enquiry" element={<OrderEnquiry />} />
          <Route path="/customer/orders" element={<CustomerOrders />} />
          <Route path="/customer/track" element={<TrackOrders />} />
          <Route path="/customer/complaints" element={<RaiseComplaint />} />

          {/* Legacy route — old bookmarks/links to the combined Shop page
              now land on the Product Catalog instead. */}
          <Route path="/customer/shop" element={<Navigate to="/customer/catalog" replace />} />

          {/* End User journey (area/taluk-scoped field officer) */}
          <Route path="/end-user/dashboard" element={<EndUserDashboard />} />
          <Route path="/end-user/customers" element={<EndUserCustomerList />} />
          <Route path="/end-user/customers/add" element={<EndUserAddCustomer />} />
          <Route path="/end-user/product-selection" element={<EndUserProductSelection />} />
          <Route path="/end-user/order-cart" element={<CartCheckout />} />
          <Route path="/end-user/enquiry" element={<Navigate to="/master/enquiry" replace />} />
          <Route path="/end-user/complaints" element={<ComplaintsAndClaims />} />
          <Route path="/end-user/drafts" element={<Drafts />} />
          {/* Notifications page (same component, one route per role area) */}
          <Route path="/customer/notifications" element={<Notifications />} />
          <Route path="/end-user/notifications" element={<Notifications />} />
          <Route path="/master/notifications" element={<Notifications />} />

          <Route path="/select-category" element={<SelectCategory />} />

          {/* Master – Order Enquiry */}
          <Route path="/master/enquiry" element={<StaffOrderEnquiry />} />

          {/* Master – Products */}
          <Route path="/master/products" element={<ProductList />} />
          <Route path="/master/products/add" element={<AddProduct />} />
          <Route path="/master/products/:id" element={<ProductView />} />

          {/* Master – Customers (no longer in the sidebar; routes kept so
              direct links still work) */}
          <Route path="/master/customers" element={<CustomerList />} />
          <Route path="/master/customers/add" element={<AddCustomer />} />
          <Route path="/master/customers/:id" element={<CustomerView />} />

          {/* Master – Quantity Allocation (product-wise & customer-wise) */}
          <Route path="/master/allocation" element={<Allocation />} />

          {/* Master – FIFO Stock Batches / Invoices / Claims / Compliance */}
          <Route path="/master/batches" element={<Batches />} />
          <Route path="/master/invoices" element={<Invoices />} />
          <Route path="/master/claims" element={<ComplaintsAndClaims />} />
          <Route path="/master/compliance" element={<ComplianceDashboard />} />
          <Route path="/master/available-stock" element={<AvailableStock />} />

          {/* The standalone Expired Partials page was removed. Its content is
              the "Expired Partials" tab of Order Details > Pending
              Allocation. This redirect keeps old links (and the button on
              Marketing Review, until it is removed) working. */}
          <Route
            path="/master/partial-expired"
            element={<Navigate to="/master/sales-order?view=pending_allocation&expired=1" replace />}
          />

          {/* Master – Orders */}
          <Route path="/master/orders" element={<OrderList />} />
          <Route path="/master/orders/add" element={<AddOrder />} />
          <Route path="/master/orders/:id" element={<OrderView />} />

          {/* Order List dropdown targets — "Sale Loss" and "Reject" for each role.
              OrderList.jsx navigates to these paths (SALE_LOSS_PATHS / REJECT_PATHS).
              Each one opens the matching tab of Today's Orders (SalesOrder page).
              ⚠️ The ?view= values (sale_loss / rejected) must match the tab keys
              used inside SalesOrder.jsx — change them here if yours differ. */}
          <Route
            path="/master/admin/sale-loss"
            element={<Navigate to="/master/sales-order?view=sale_loss" replace />}
          />
          <Route
            path="/master/admin/rejected"
            element={<Navigate to="/master/sales-order?view=rejected" replace />}
          />
          <Route path="/master/sale-loss" element={<SaleLossList />} />
          <Route path="/master/rejected" element={<RejectedList />} />

          {/* Order Details = Today's Orders (today's orders only) and Credit Limit */}
          <Route path="/master/sales-order" element={<SalesOrder />} />
          {/* ERP staging view: sale_order_header + sale_order_line */}
          <Route path="/master/erp-sale-orders" element={<ErpSaleOrders />} />
          <Route path="/master/credit-limit" element={<CreditLimit />} />

          {/* Admin Master (Super Admin only) */}
          <Route path="/master/admin-master/users" element={<AdminMasterUsers />} />
          <Route path="/master/admin-master/users/add" element={<AdminMasterUserForm />} />
          <Route path="/master/admin-master/users/:id/edit" element={<AdminMasterUserForm />} />

          {/* Status */}
          <Route path="/status/customers" element={<CustomerList />} />
          <Route path="/status/orders" element={<OrderList />} />
          <Route path="/status/employees" element={<AllocationEmployeeDirectory />} />
          <Route path="/status/employees/manage" element={<AllocationSystemAdmin />} />
          <Route path="/status/end-users" element={<AllocationAdminEndUsers />} />

          {/* Reports */}
          <Route path="/reports" element={<Navigate to="/reports/enquiry" replace />} />
          <Route path="/reports/enquiry" element={<EnquiryOrderReportPage />} />
          <Route path="/reports/overdue" element={<OverdueReportPage />} />
          <Route path="/reports/data" element={<DataReportPage />} />
          <Route path="/reports/product-wise" element={<ProductWiseReportPage />} />
          <Route path="/reports/ageing" element={<AgeingReportPage />} />
          <Route path="/reports/sales-loss" element={<SalesLossReportPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;