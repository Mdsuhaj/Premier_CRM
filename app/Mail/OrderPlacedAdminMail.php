<?php

namespace App\Mail;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Sent to the Admin(s) covering a customer's District whenever a new
 * order is created — whether it was placed by the Customer directly
 * (cart checkout) or by an End User on the customer's behalf.
 *
 * Flow: CUSTOMER -> Places Order -> CRM creates Order -> Email -> Admin
 * Flow: END USER  -> Places Order -> CRM creates Order -> Email -> Admin
 */
class OrderPlacedAdminMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public Order $order, public string $placedByLabel = 'Customer')
    {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'New Order Placed — ' . $this->order->Code,
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.order-placed-admin',
            with: [
                'order' => $this->order->loadMissing(['customer', 'product', 'creator']),
                'placedByLabel' => $this->placedByLabel,
            ],
        );
    }
}
