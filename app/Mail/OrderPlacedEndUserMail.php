<?php

namespace App\Mail;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Sent to the End User(s) (Field Officers) covering a customer's Taluk
 * when that customer places a new order (cart checkout).
 *
 * Flow: CUSTOMER -> Places Order -> CRM creates Order -> Email -> End User
 */
class OrderPlacedEndUserMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public Order $order)
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
            view: 'emails.order-placed-enduser',
            with: [
                'order' => $this->order->loadMissing(['customer', 'product']),
            ],
        );
    }
}
