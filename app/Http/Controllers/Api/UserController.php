<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Admin Master — account provisioning for staff logins.
 *
 * This is deliberately independent of EmployeeController/employee_mst
 * (which drives the District/Taluk approval workflow). Admin Master
 * creates a login directly — role + password + active/inactive — with
 * no approval step, for the roles Super Admin is allowed to provision:
 * end_user, customer, admin, system_admin.
 *
 * A `customer` login ALSO gets a linked row in the Customers table
 * (Customers.UserId = users.id). The order/enquiry flow looks the
 * customer up by that link, so without it a customer cannot submit
 * an enquiry ("No customer profile is linked to this account").
 *
 * Only super_admin may call these endpoints.
 */
class UserController extends Controller
{
    /** Roles Admin Master is allowed to manage. */
    private const MANAGEABLE_ROLES = ['end_user', 'customer', 'admin', 'system_admin'];

    private function ensureSuperAdmin(Request $request)
    {
        $caller = $request->user();
        if (!$caller || $caller->role !== 'super_admin') {
            return response()->json(['message' => 'Only Super Admin can manage accounts here.'], 403);
        }
        return null;
    }

    /** GET /api/accounts — list end_user / customer / admin / system_admin logins */
    public function index(Request $request)
    {
        if ($deny = $this->ensureSuperAdmin($request))
            return $deny;

        $query = User::query()->whereIn('role', self::MANAGEABLE_ROLES);

        if ($roles = $request->query('roles')) {
            $rolesArray = array_values(array_intersect(
                array_filter(array_map('trim', explode(',', $roles))),
                self::MANAGEABLE_ROLES
            ));
            if (!empty($rolesArray)) {
                $query->whereIn('role', $rolesArray);
            }
        }

        if ($request->query('active_only')) {
            $query->where('Status', 'active');
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%")
                    ->orWhere('Designation', 'like', "%{$search}%");
            });
        }

        return response()->json($query->orderByDesc('id')->get());
    }

    /** GET /api/accounts/{id} */
    public function show(Request $request, $id)
    {
        if ($deny = $this->ensureSuperAdmin($request))
            return $deny;

        $user = User::whereIn('role', self::MANAGEABLE_ROLES)->find($id);
        if (!$user) {
            return response()->json(['message' => 'Account not found'], 404);
        }
        return response()->json($user);
    }

    /** POST /api/accounts */
    public function store(Request $request)
    {
        if ($deny = $this->ensureSuperAdmin($request))
            return $deny;

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'userId' => 'required|string|max:255|unique:users,email',
            'designation' => 'required|string|max:255',
            'state' => 'nullable|string|max:100',
            'district' => 'nullable|string|max:100',
            'role' => ['required', Rule::in(self::MANAGEABLE_ROLES)],
            'password' => 'required|string|min:4|confirmed',
            'active' => 'required|boolean',
            'oracleId' => 'nullable|string|max:50',
        ]);

        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first(), 'errors' => $validator->errors()], 422);
        }
        $data = $validator->validated();

        // A customer login is useless without a Customers row (the order flow
        // looks it up by UserId), and that row needs a district.
        if ($data['role'] === 'customer' && empty($data['district'])) {
            return response()->json(['message' => 'District is required for a customer account.'], 422);
        }

        // User + (for customers) the linked Customers row are created together,
        // all-or-nothing, so we never end up with a customer login that has no profile.
        $user = DB::transaction(function () use ($data, $request) {
            $user = new User();
            $user->name = $data['name'];
            $user->email = $data['userId'];
            $user->role = $data['role'];
            $user->password = $data['password']; // hashed by the model's saving hook
            $user->Designation = $data['designation'];
            $user->State = $data['state'] ?? null;
            $user->District = $data['district'] ?? null;
            $user->Status = $data['active'] ? 'active' : 'inactive';
            $user->save();

            if ($user->role === 'customer') {
                $this->createCustomerProfile($user, $request->user()->id, $data['oracleId'] ?? null);
            }

            return $user;
        });

        return response()->json($user, 201);
    }

    /** PUT/PATCH /api/accounts/{id} */
    public function update(Request $request, $id)
    {
        if ($deny = $this->ensureSuperAdmin($request))
            return $deny;

        $user = User::whereIn('role', self::MANAGEABLE_ROLES)->find($id);
        if (!$user) {
            return response()->json(['message' => 'Account not found'], 404);
        }

        $validator = Validator::make($request->all(), [
            'name' => 'sometimes|required|string|max:255',
            'userId' => ['sometimes', 'required', 'string', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'designation' => 'sometimes|required|string|max:255',
            'state' => 'nullable|string|max:100',
            'district' => 'nullable|string|max:100',
            'role' => ['sometimes', 'required', Rule::in(self::MANAGEABLE_ROLES)],
            // Password is optional on edit — leave blank to keep the current one.
            'password' => 'nullable|string|min:4|confirmed',
            'active' => 'sometimes|required|boolean',
            'oracleId' => 'nullable|string|max:50',
        ]);

        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first(), 'errors' => $validator->errors()], 422);
        }
        $data = $validator->validated();

        if (array_key_exists('name', $data))
            $user->name = $data['name'];
        if (array_key_exists('userId', $data))
            $user->email = $data['userId'];
        if (array_key_exists('designation', $data))
            $user->Designation = $data['designation'];
        if (array_key_exists('state', $data))
            $user->State = $data['state'];
        if (array_key_exists('district', $data))
            $user->District = $data['district'];
        if (array_key_exists('role', $data))
            $user->role = $data['role'];
        if (array_key_exists('active', $data))
            $user->Status = $data['active'] ? 'active' : 'inactive';
        if (!empty($data['password']))
            $user->password = $data['password'];

        if ($user->role === 'customer' && empty($user->District)) {
            return response()->json(['message' => 'District is required for a customer account.'], 422);
        }

        DB::transaction(function () use ($user, $request, $data) {
            $user->save();

            // Keep the linked Customers row in step with the login, and create
            // it if someone is switched to the customer role after the fact.
            if ($user->role === 'customer') {
                $customer = Customer::where('UserId', $user->id)->first();
                if (!$customer) {
                    $this->createCustomerProfile($user, $request->user()->id, $data['oracleId'] ?? null);
                } else {
                    $upd = [
                        'Name' => $user->name,
                        'District' => (string) ($user->District[0] ?? ''),
                        'Status' => $user->Status === 'active' ? 'approved' : 'pending',
                    ];
                    if (!empty($data['oracleId'])) {
                        $upd['OracleId'] = trim($data['oracleId']);
                    }
                    $customer->update($upd);
                }
            }
        });

        return response()->json($user);
    }

    /** DELETE /api/accounts/{id} */
    public function destroy(Request $request, $id)
    {
        if ($deny = $this->ensureSuperAdmin($request))
            return $deny;

        $user = User::whereIn('role', self::MANAGEABLE_ROLES)->find($id);
        if (!$user) {
            return response()->json(['message' => 'Account not found'], 404);
        }

        if ($user->id === $request->user()->id) {
            return response()->json(['message' => 'You cannot delete your own account.'], 422);
        }

        // A customer who already has orders can't be deleted without breaking
        // order history - tell the admin instead of failing with a 500.
        $customer = Customer::where('UserId', $user->id)->first();
        if ($customer && \App\Models\Order::where('CustomerId', $customer->Id)->exists()) {
            return response()->json([
                'message' => 'This customer already has orders, so the account cannot be deleted. '
                    . 'Set Active Status to "No" instead to block login.',
            ], 422);
        }

        try {
            DB::transaction(function () use ($user, $customer) {
                \App\Models\AppNotification::where('UserId', $user->id)->delete();
                if ($customer) {
                    $customer->delete();
                }
                $user->delete();
            });
        } catch (\Throwable $e) {
            \Log::warning('Account delete failed', ['userId' => $user->id, 'error' => $e->getMessage()]);
            return response()->json([
                'message' => 'This account is linked to other records and cannot be deleted. Set it inactive instead.',
            ], 422);
        }

        return response()->json(['message' => 'Account deleted']);
    }

    /**
     * Create the Customers row that a customer login needs (linked by UserId).
     * Admin Master has no taluk / phone fields, so the district stands in for
     * the taluk and the phone is a placeholder — Marketing can edit both later
     * on the customer's own page.
     */
    private function createCustomerProfile(User $user, int $createdBy, ?string $oracleId = null): Customer
    {
        $last = Customer::orderByDesc('Id')->first();
        $next = $last ? ((int) Str::after($last->Code, 'CUST-')) + 1 : 1;

        $district = (string) ($user->District[0] ?? '');
        $oracleId = trim((string) $oracleId) !== '' ? trim($oracleId) : $this->findOracleId($user->name);

        return Customer::create([
            'Code' => 'CUST-' . str_pad($next, 3, '0', STR_PAD_LEFT),
            'UserId' => $user->id,
            'Name' => $user->name,
            'Phone' => '-',
            'Email' => null,
            'Type' => 'retail',
            'District' => $district,
            'Taluk' => $district,
            'Outstanding' => 0,
            'OracleId' => $oracleId,
            'Status' => $user->Status === 'active' ? 'approved' : 'pending',
            'CreatedBy' => $createdBy,
        ]);
    }

    /** Best-effort: find this customer's ERP partner number by exact name. Never blocks saving. */
    private function findOracleId(string $name): ?string
    {
        try {
            $conn = \Illuminate\Support\Facades\DB::connection('oracle');
            $norm = fn($s) => preg_replace('/[^A-Z0-9]/', '', mb_strtoupper((string) $s));
            $want = $norm($name);
            $first = mb_strtoupper(preg_split('/\s+/', trim($name))[0] ?? '');
            if ($want === '' || $first === '') {
                return null;
            }

            // Business partner master first: exact short/legal name -> NUMBERID
            $nm = mb_strtoupper(trim($name));
            $bp = $conn->table('BUSINESSPARTNER')
                ->where(function ($q) use ($nm) {
                    $q->whereRaw('UPPER(TRIM(SHORTNAME)) = ?', [$nm])
                        ->orWhereRaw('UPPER(TRIM(LEGALNAME1)) = ?', [$nm]);
                })
                ->first();
            if ($bp) {
                $a = array_change_key_case((array) $bp, CASE_UPPER);
                $no = trim((string) ($a['NUMBERID'] ?? ''));
                if ($no !== '') {
                    return $no;
                }
            }

            $cands = [];
            foreach ($conn->table('ADDRESS')->whereRaw('UPPER(ADDRESSEE) LIKE ?', ['%' . $first . '%'])->get() as $r) {
                $a = array_change_key_case((array) $r, CASE_UPPER);
                if ($norm($a['ADDRESSEE'] ?? '') !== $want) {
                    continue;
                }
                foreach ($a as $k => $v) {
                    if ($v !== null && is_scalar($v) && preg_match('/(CODE|ID|NUMBER)/', $k)) {
                        $v = trim((string) $v);
                        if ($v !== '' && strlen($v) <= 30) {
                            $cands[] = $v;
                        }
                    }
                }
            }

            foreach (array_unique($cands) as $cand) {
                foreach (['ORDERBUSINESSPARTNERNUMBERID', 'CUSTOMERSUPPLIERCODE'] as $col) {
                    $row = $conn->table('ORDERPARTNER')
                        ->whereRaw("TRIM(TO_CHAR({$col})) = ?", [$cand])
                        ->whereNotNull('DELIVERYPOINTUNIQUEID')
                        ->first();
                    if ($row) {
                        $a = array_change_key_case((array) $row, CASE_UPPER);
                        $no = trim((string) ($a['ORDERBUSINESSPARTNERNUMBERID'] ?? $cand));
                        return $no !== '' ? $no : null;
                    }
                }
            }
        } catch (\Throwable $e) {
            \Log::info('Oracle partner lookup skipped', ['name' => $name, 'error' => $e->getMessage()]);
        }
        return null;
    }
}