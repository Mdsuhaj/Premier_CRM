<?php

namespace App\Http\Controllers\Api;

use Illuminate\Support\Facades\DB;
use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Employee;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CustomerController extends Controller
{
    /**
     * GET /api/customers
     *
     * Scoping:
     *   - `customer`  → only their own record (Customers.UserId)
     *   - `end_user`  → only customers whose Taluk matches one of the
     *                   end_user's own assigned Taluk(s) (Field Officer,
     *                   area-scoped)
     *   - `admin`     → only customers whose District matches one of the
     *                   admin's own assigned District(s)
     *   - `system_admin` / `super_admin` → full list, unscoped
     */
    public function index(Request $request)
    {

        // Serve Oracle BUSINESSPARTNER data instead of the local Customers
        // table when explicitly asked for (?source=oracle), without
        // touching the existing local-customer behavior below.

        // if ($request->query('source') === 'oracle') {
        //     $partners = DB::connection('oracle')
        //         ->table('BUSINESSPARTNER')
        //         ->select('NUMBERID', 'SHORTNAME')
        //         ->whereNotNull('SHORTNAME')
        //         ->orderBy('SHORTNAME')
        //         ->get();

        //     return response()->json(
        //         $partners->map(fn($p) => [
        //             'Id' => $p->NUMBERID,
        //             'Name' => $p->SHORTNAME,
        //         ])
        //     );
        // }

        if ($request->query('source') === 'oracle') {
            $caller = $request->user();

            $query = DB::connection('oracle')
                ->table('BUSINESSPARTNER')
                ->select('NUMBERID', 'SHORTNAME', 'TOWN', 'DISTRICT', 'ADDRESSPHONENUMBER', 'EMAILADDRESS', 'TAXREGISTRATIONNUMBER')
                ->whereNotNull('SHORTNAME');

            // Only real customers, never suppliers — ORDERPARTNER links a
            // BUSINESSPARTNER to CUSTOMERSUPPLIERTYPE (1 = customer,
            // 2 = supplier) via ORDERBUSINESSPARTNERNUMBERID. Also require
            // ORDERCATEGORYCODE = 'DOM' (domestic) on that same ORDERPARTNER
            // row — a BUSINESSPARTNER can have several ORDERPARTNER rows
            // (different categories), so both conditions must hold on the
            // SAME row, not just somewhere across the partner's rows —
            // hence one whereExists with both conditions inside it, not two
            // separate ones.
            $query->whereExists(function ($q) {
                $q->select(DB::raw(1))
                    ->from('ORDERPARTNER as o')
                    ->whereColumn('o.ORDERBUSINESSPARTNERNUMBERID', 'BUSINESSPARTNER.NUMBERID')
                    ->where('o.CUSTOMERSUPPLIERTYPE', '1')
                    ->where('o.ORDERCATEGORYCODE', 'DOM');
            });

            // Scope by end_user's assigned area — Oracle uses TOWN/DISTRICT
            // (no TALUK column exists in BUSINESSPARTNER). An end_user's
            // area can come from either the Employee District/Taluk
            // approval workflow, OR the District field set directly on
            // their User row via Admin Master (see UserController::store).
            // Fail closed: if neither is set, show nothing rather than
            // everything.
            if ($caller && $caller->role === 'end_user') {
                $employee = Employee::where('UserId', $caller->id)->first();

                $normalize = function ($raw) {
                    if (is_array($raw)) {
                        return array_values(array_filter($raw));
                    }
                    if (is_string($raw) && $raw !== '') {
                        $decoded = json_decode($raw, true);
                        return (json_last_error() === JSON_ERROR_NONE && is_array($decoded))
                            ? array_values(array_filter($decoded))
                            : [$raw];
                    }
                    return [];
                };

                $taluks = $normalize($employee->Taluk ?? $caller->Taluk ?? null);
                $districts = $normalize($employee->District ?? $caller->District ?? null);

                if (!empty($taluks) || !empty($districts)) {
                    $query->where(function ($q) use ($taluks, $districts) {
                        foreach ($taluks as $t) {
                            $q->orWhereRaw("UPPER(TOWN) LIKE UPPER(?)", ['%' . $t . '%'])
                                ->orWhereRaw("UPPER(DISTRICT) LIKE UPPER(?)", ['%' . $t . '%']);
                        }
                        foreach ($districts as $d) {
                            $q->orWhereRaw("UPPER(DISTRICT) LIKE UPPER(?)", ['%' . $d . '%']);
                        }
                    });
                } else {
                    $query->whereRaw('1 = 0'); // no assigned area yet → see nothing
                }
            }

            // Scope by admin's assigned District
            if ($caller && $caller->role === 'admin') {
                $employee = Employee::where('UserId', $caller->id)->first();
                $rawDistricts = $employee->District ?? $caller->District ?? null;
                $districts = [];
                if (is_array($rawDistricts)) {
                    $districts = array_values(array_filter($rawDistricts));
                } elseif (is_string($rawDistricts) && $rawDistricts !== '') {
                    $decoded = json_decode($rawDistricts, true);
                    $districts = (json_last_error() === JSON_ERROR_NONE && is_array($decoded))
                        ? array_values(array_filter($decoded))
                        : [$rawDistricts];
                }

                if (!empty($districts)) {
                    $query->where(function ($q) use ($districts) {
                        foreach ($districts as $d) {
                            $q->orWhereRaw("UPPER(DISTRICT) LIKE UPPER(?)", ['%' . $d . '%']);
                        }
                    });
                }
            }

            return response()->json(
                $query->orderBy('SHORTNAME')->get()
            );
        }

        $query = Customer::with('user');
        $caller = $request->user();

        if ($caller && $caller->role === 'customer') {
            $query->where('UserId', $caller->id);
        }

        if ($caller && $caller->role === 'end_user') {
            $taluks = $this->callerAreas($caller, 'Taluk');
            $districts = $this->callerAreas($caller, 'District');
            $query->where(function ($q) use ($taluks, $districts) {
                if (!empty($taluks)) {
                    $q->whereIn('Taluk', $taluks);
                }
                if (!empty($districts)) {
                    $q->orWhereIn('District', $districts);
                }
                if (empty($taluks) && empty($districts)) {
                    $q->whereRaw('1 = 0'); // no assigned area yet → see nothing
                }
            });
        }

        if ($caller && $caller->role === 'admin') {
            $districts = $this->callerAreas($caller, 'District');
            $query->where(function ($q) use ($districts) {
                foreach ($districts as $d) {
                    $q->orWhere('District', $d);
                }
                if (empty($districts)) {
                    $q->whereRaw('1 = 0'); // no assigned district yet → see nothing
                }
            });
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('Name', 'like', "%{$search}%")
                    ->orWhere('Code', 'like', "%{$search}%")
                    ->orWhere('Phone', 'like', "%{$search}%");
            });
        }

        if ($type = $request->query('type')) {
            $query->where('Type', $type);
        }

        if ($status = $request->query('status')) {
            $query->where('Status', $status);
        }

        return response()->json(
            $query->orderByDesc('Id')->get()
        );
    }

    /**
     * Normalise a caller's own assigned District/Taluk (from their linked
     * Employee record, falling back to the User row) into a clean array.
     */
    private function callerAreas($caller, string $field): array
    {
        $employee = Employee::where('UserId', $caller->id)->first();
        $value = $employee->{$field} ?? $caller->{$field} ?? null;

        if (is_array($value)) {
            return array_values(array_filter($value, fn($v) => $v !== null && $v !== ''));
        }
        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                return array_values(array_filter($decoded, fn($v) => $v !== null && $v !== ''));
            }
            return [$value];
        }
        return [];
    }

    /** GET /api/customers/{id} */
    public function show(Request $request, $id)
    {
        $customer = Customer::with('user')->find($id);

        if (!$customer) {
            return response()->json(['message' => 'Customer not found'], 404);
        }

        $caller = $request->user();

        if ($caller && $caller->role === 'customer' && $customer->UserId !== $caller->id) {
            return response()->json(['message' => 'You can only view your own account.'], 403);
        }

        if ($caller && $caller->role === 'end_user') {
            $taluks = $this->callerAreas($caller, 'Taluk');
            $districts = $this->callerAreas($caller, 'District');
            $matchTaluk = !empty($taluks) && in_array($customer->Taluk, $taluks, true);
            $matchDist = !empty($districts) && in_array($customer->District, $districts, true);
            if (!$matchTaluk && !$matchDist) {
                return response()->json(['message' => 'This customer is outside your assigned area.'], 403);
            }
        }

        if ($caller && $caller->role === 'admin') {
            $districts = $this->callerAreas($caller, 'District');
            if (!in_array($customer->District, $districts, true)) {
                return response()->json(['message' => 'This customer is outside your assigned District(s).'], 403);
            }
        }

        return response()->json($customer);
    }

    /**
     * POST /api/customers
     *
     * Creates the Customer record AND a linked `users` row so the
     * customer can log in themselves — matching the admin/end_user
     * pattern (username = phone, password = dob), but for customers:
     *   - username = Shop Name (Customers.Name)
     *   - password = Phone number (Customers.Phone)
     * The linked account starts inactive (blocked from login) until
     * Marketing approves the customer via updateStatus().
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:191',
            'phone' => 'required|string|max:20',
            'email' => 'nullable|email|max:191',
            'type' => 'required|in:retail,wholesale',
            'district' => 'required|string|max:100',
            'taluk' => 'required|string|max:100',
            'address' => 'nullable|string',
            'creditLimit' => 'nullable|numeric',
            'maxDiscountPct' => 'nullable|numeric|min:0|max:100',
            'notes' => 'nullable|string',

            // ── Mobile "Add Customer" parity fields ──────────────────────
            'businessType' => 'nullable|string|max:30',
            'emails' => 'nullable|array|max:2',
            'emails.*' => 'nullable|email|max:191',
            'phones' => 'nullable|array|max:2',
            'phones.*' => 'nullable|string|max:20',
            'contactPersons' => 'nullable|array|max:2',
            'contactPersons.*.contactName' => 'required_with:contactPersons|string|max:191',
            'contactPersons.*.contactPhone' => 'required_with:contactPersons|string|max:20',
            'contactPersons.*.designation' => 'nullable|string|max:100',
            'contactPersons.*.email' => 'nullable|email|max:191',
            'addresses' => 'nullable|array|max:2',
            'addresses.*.address' => 'required_with:addresses|string|max:255',
            'addresses.*.address2' => 'nullable|string|max:255',
            'addresses.*.city' => 'required_with:addresses|string|max:100',
            'addresses.*.stateName' => 'required_with:addresses|string|max:100',
            'addresses.*.district' => 'nullable|string|max:100',
            'addresses.*.country' => 'required_with:addresses|string|max:100',
            'addresses.*.pincode' => 'required_with:addresses|string|max:10',
            'gstNo' => 'nullable|string|max:15',
            'panNo' => 'nullable|string|max:10',
            'tanNo' => 'nullable|string|max:10',
        ]);

        $caller = $request->user();

        // Same area scoping used for viewing customers (index()/show()),
        // now enforced on creation too:
        //   - Field Officer (end_user): can only add a customer inside
        //     their own assigned District AND Taluk — e.g. an end_user
        //     assigned to Madurai / Madurai North + Tirumangalam can only
        //     create customers in exactly that district+taluk combination.
        //   - Marketing (admin): can only add a customer inside their own
        //     assigned District(s) — any taluk within that district is
        //     fine (e.g. a Madurai admin can add a customer in any taluk
        //     of Madurai, but not in another district).
        //   - System Admin (and Super Admin): unrestricted — can add a
        //     customer for any district/taluk, regardless of their own
        //     assignment.
        if ($caller && $caller->role === 'end_user') {
            $taluks = $this->callerAreas($caller, 'Taluk');
            $districts = $this->callerAreas($caller, 'District');
            $matchTaluk = !empty($taluks) && in_array($validated['taluk'], $taluks, true);
            $matchDist = !empty($districts) && in_array($validated['district'], $districts, true);
            if (!$matchTaluk && !$matchDist) {
                return response()->json([
                    'message' => 'You can only add customers in your own assigned District / Taluk(s).',
                ], 403);
            }
        }

        if ($caller && $caller->role === 'admin') {
            $districts = $this->callerAreas($caller, 'District');
            if (empty($districts) || !in_array($validated['district'], $districts, true)) {
                return response()->json([
                    'message' => 'You can only add customers in your own assigned District(s).',
                ], 403);
            }
        }

        $emails = array_values(array_filter($validated['emails'] ?? [], fn($e) => !empty($e)));
        $phones = array_values(array_filter($validated['phones'] ?? [], fn($p) => !empty($p)));
        $primaryEmail = $validated['email'] ?? ($emails[0] ?? null);
        $primaryPhone = $validated['phone'] ?? ($phones[0] ?? null);
        $primaryAddress = $validated['addresses'][0]['address'] ?? ($validated['address'] ?? null);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $primaryEmail ?? (Str::slug($validated['name']) . '-' . uniqid() . '@premiercrm.com'),
            'phone' => $validated['phone'],
            'password' => $validated['phone'],
            'role' => 'customer',
            'Status' => 'inactive', // pending approval — login blocked until active
        ]);

        $customer = Customer::create([
            'Code' => $this->generateCustomerCode(),
            'UserId' => $user->id,
            'Name' => $validated['name'],
            'Phone' => $primaryPhone,
            'Email' => $primaryEmail,
            'Type' => $validated['type'],
            'District' => $validated['district'],
            'Taluk' => $validated['taluk'],
            'Address' => $primaryAddress,
            'CreditLimit' => $validated['creditLimit'] ?? null,
            'MaxDiscountPct' => $validated['maxDiscountPct'] ?? null,
            'Outstanding' => 0,
            'Status' => 'pending',
            'Notes' => $validated['notes'] ?? null,
            'CreatedBy' => $request->user()->id,

            'BusinessType' => $validated['businessType'] ?? null,
            'Emails' => !empty($emails) ? $emails : null,
            'Phones' => !empty($phones) ? $phones : null,
            'Addresses' => $validated['addresses'] ?? null,
            'ContactPersons' => $validated['contactPersons'] ?? null,
            'GSTNo' => $validated['gstNo'] ?? null,
            'PANNo' => $validated['panNo'] ?? null,
            'TANNo' => $validated['tanNo'] ?? null,
        ]);

        return response()->json($customer->load('user'), 201);
    }

    /** PUT /api/customers/{id} */
    public function update(Request $request, $id)
    {
        $customer = Customer::find($id);

        if (!$customer) {
            return response()->json(['message' => 'Customer not found'], 404);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:191',
            'phone' => 'sometimes|required|string|max:20',
            'email' => 'nullable|email|max:191',
            'type' => 'sometimes|required|in:retail,wholesale',
            'district' => 'sometimes|required|string|max:100',
            'taluk' => 'sometimes|required|string|max:100',
            'address' => 'nullable|string',
            'creditLimit' => 'nullable|numeric',
            'maxDiscountPct' => 'nullable|numeric|min:0|max:100',
            'outstanding' => 'nullable|numeric',
            'status' => 'sometimes|required|in:approved,pending,declined',
            'notes' => 'nullable|string',

            // ── Mobile "Add Customer" parity fields ──────────────────────
            'businessType' => 'nullable|string|max:30',
            'emails' => 'nullable|array|max:2',
            'emails.*' => 'nullable|email|max:191',
            'phones' => 'nullable|array|max:2',
            'phones.*' => 'nullable|string|max:20',
            'contactPersons' => 'nullable|array|max:2',
            'contactPersons.*.contactName' => 'required_with:contactPersons|string|max:191',
            'contactPersons.*.contactPhone' => 'required_with:contactPersons|string|max:20',
            'contactPersons.*.designation' => 'nullable|string|max:100',
            'contactPersons.*.email' => 'nullable|email|max:191',
            'addresses' => 'nullable|array|max:2',
            'addresses.*.address' => 'required_with:addresses|string|max:255',
            'addresses.*.address2' => 'nullable|string|max:255',
            'addresses.*.city' => 'required_with:addresses|string|max:100',
            'addresses.*.stateName' => 'required_with:addresses|string|max:100',
            'addresses.*.district' => 'nullable|string|max:100',
            'addresses.*.country' => 'required_with:addresses|string|max:100',
            'addresses.*.pincode' => 'required_with:addresses|string|max:10',
            'gstNo' => 'nullable|string|max:15',
            'panNo' => 'nullable|string|max:10',
            'tanNo' => 'nullable|string|max:10',
        ]);

        $map = [
            'name' => 'Name',
            'phone' => 'Phone',
            'email' => 'Email',
            'type' => 'Type',
            'district' => 'District',
            'taluk' => 'Taluk',
            'address' => 'Address',
            'creditLimit' => 'CreditLimit',
            'maxDiscountPct' => 'MaxDiscountPct',
            'outstanding' => 'Outstanding',
            'status' => 'Status',
            'notes' => 'Notes',
            'businessType' => 'BusinessType',
            'gstNo' => 'GSTNo',
            'panNo' => 'PANNo',
            'tanNo' => 'TANNo',
        ];

        $update = [];
        foreach ($map as $reqKey => $column) {
            if (array_key_exists($reqKey, $validated)) {
                $update[$column] = $validated[$reqKey];
            }
        }

        if (array_key_exists('emails', $validated)) {
            $emails = array_values(array_filter($validated['emails'], fn($e) => !empty($e)));
            $update['Emails'] = !empty($emails) ? $emails : null;
            if (!empty($emails))
                $update['Email'] = $emails[0];
        }
        if (array_key_exists('phones', $validated)) {
            $phones = array_values(array_filter($validated['phones'], fn($p) => !empty($p)));
            $update['Phones'] = !empty($phones) ? $phones : null;
            if (!empty($phones))
                $update['Phone'] = $phones[0];
        }
        if (array_key_exists('addresses', $validated)) {
            $update['Addresses'] = !empty($validated['addresses']) ? $validated['addresses'] : null;
            if (!empty($validated['addresses']))
                $update['Address'] = $validated['addresses'][0]['address'];
        }
        if (array_key_exists('contactPersons', $validated)) {
            $update['ContactPersons'] = !empty($validated['contactPersons']) ? $validated['contactPersons'] : null;
        }

        if (isset($update['Status']) && $update['Status'] === 'approved') {
            $update['ApprovedBy'] = $request->user()->id;
        }

        $customer->update($update);

        // Keep the linked login account (username = Name, password = Phone)
        // in sync whenever these change here.
        if ($customer->user) {
            $userUpdate = [];
            if (isset($update['Name']))
                $userUpdate['name'] = $update['Name'];
            if (isset($update['Phone'])) {
                $userUpdate['phone'] = $update['Phone'];
                $userUpdate['password'] = $update['Phone'];
            }
            if (isset($update['Status'])) {
                $userUpdate['Status'] = $update['Status'] === 'approved' ? 'active' : 'inactive';
            }
            if (!empty($userUpdate)) {
                $customer->user->update($userUpdate);
            }
        }

        return response()->json($customer->load('user'));
    }

    /** DELETE /api/customers/{id} */
    public function destroy($id)
    {
        $customer = Customer::find($id);

        if (!$customer) {
            return response()->json(['message' => 'Customer not found'], 404);
        }

        // Deleting the Customer should also remove their login — otherwise
        // an orphaned account (belonging to no one) stays able to log in.
        $customer->user?->delete();
        $customer->delete();

        return response()->json(['message' => 'Customer deleted']);
    }

    /** PATCH /api/customers/{id}/status */
    public function updateStatus(Request $request, $id)
    {
        $customer = Customer::find($id);

        if (!$customer) {
            return response()->json(['message' => 'Customer not found'], 404);
        }

        $validated = $request->validate([
            'status' => 'required|in:approved,pending,declined',
        ]);

        $update = ['Status' => $validated['status']];

        if ($validated['status'] === 'approved') {
            $update['ApprovedBy'] = $request->user()->id;
        }

        $customer->update($update);

        // Approving a customer unlocks their login; anything else blocks it.
        if ($customer->user) {
            $customer->user->update([
                'Status' => $validated['status'] === 'approved' ? 'active' : 'inactive',
            ]);
        }

        return response()->json($customer->load('user'));
    }

    private function generateCustomerCode(): string
    {
        $last = Customer::orderByDesc('Id')->first();
        $nextNumber = $last ? ((int) Str::after($last->Code, 'CUST-')) + 1 : 1;

        return 'CUST-' . str_pad($nextNumber, 3, '0', STR_PAD_LEFT);
    }
}