<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>New Order Placed</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family: Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:24px 0;">
        <tr>
            <td align="center">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">
                    <tr>
                        <td style="background-color:#1f2937; padding:20px 32px;">
                            <span style="color:#ffffff; font-size:18px; font-weight:bold;">{{ config('app.name') }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:32px;">
                            <h2 style="margin:0 0 8px 0; color:#111827;">New Order Placed</h2>
                            <p style="color:#374151; font-size:14px; line-height:1.5;">
                                A customer in your area has placed a new order.
                            </p>

                            <table role="presentation" width="100%" cellpadding="8" cellspacing="0" style="margin:20px 0; border:1px solid #e5e7eb; border-radius:6px; font-size:14px; color:#111827;">
                                <tr style="background-color:#f9fafb;">
                                    <td style="font-weight:bold; width:40%;">Order Code</td>
                                    <td>{{ $order->Code }}</td>
                                </tr>
                                <tr>
                                    <td style="font-weight:bold;">Customer</td>
                                    <td>{{ $order->customer->Name ?? '—' }}</td>
                                </tr>
                                <tr style="background-color:#f9fafb;">
                                    <td style="font-weight:bold;">Product</td>
                                    <td>{{ $order->product->Name ?? '—' }}</td>
                                </tr>
                                <tr>
                                    <td style="font-weight:bold;">Quantity</td>
                                    <td>{{ $order->Quantity }}</td>
                                </tr>
                                <!-- <tr style="background-color:#f9fafb;">
                                    <td style="font-weight:bold;">Total Amount</td>
                                    <td>₹{{ number_format((float) $order->TotalAmount, 2) }}</td>
                                </tr> -->
                                <tr>
                                    <td style="font-weight:bold;">Delivery Date</td>
                                    <td>{{ optional($order->DeliveryDate)->format('d M Y') ?? '—' }}</td>
                                </tr>
                            </table>

                            <p style="color:#374151; font-size:14px;">Please review and assign this enquiry as needed.</p>

                            <!-- <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                                <tr>
                                    <td style="background-color:#2563eb; border-radius:6px;">
                                        <a href="{{ config('app.frontend_url', config('app.url')) }}/orders/{{ $order->Id }}"
                                           style="display:inline-block; padding:10px 20px; color:#ffffff; text-decoration:none; font-size:14px; font-weight:bold;">
                                            View Order
                                        </a>
                                    </td>
                                </tr>
                            </table> -->
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:16px 32px; background-color:#f9fafb; color:#9ca3af; font-size:12px;">
                            {{ config('app.name') }}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
