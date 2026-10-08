<?php

namespace App\Mail;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Sent to the System Admin(s) when an Admin allots (assigns) an order.
 *
 * Flow: ADMIN -> Allots Order -> CRM updates Order -> Email -> System Admin
 */
class OrderAllottedSystemAdminMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public Order $order)
    {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Order Allotted — ' . $this->order->Code,
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.order-allotted-sysadmin',
            with: [
                'order' => $this->order->loadMissing(['customer', 'product', 'assignee']),
            ],
        );
    }
}
