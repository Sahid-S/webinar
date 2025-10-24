const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve static files from current directory

// Razorpay credentials (In production, use environment variables)
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// Create order endpoint
app.post('/create-order', async (req, res) => {
    try {
        const { amount, currency, receipt, notes } = req.body;
        
        const orderData = {
            amount: amount || 29900, // ₹299 in paise
            currency: currency || 'INR',
            receipt: receipt || 'webinar_' + Date.now(),
            notes: notes || {}
        };

        const response = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(RAZORPAY_KEY_ID + ':' + RAZORPAY_KEY_SECRET).toString('base64')
            },
            body: JSON.stringify(orderData)
        });

        const order = await response.json();

        if (!response.ok) {
            throw new Error(order.error?.description || 'Failed to create order');
        }

        res.json(order);
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ 
            error: error.message,
            details: 'Failed to create Razorpay order'
        });
    }
});

// Verify payment endpoint
app.post('/verify-payment', async (req, res) => {
    try {
        const crypto = require('crypto');
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        // Create signature for verification
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
                                       .update(body.toString())
                                       .digest('hex');

        if (expectedSignature === razorpay_signature) {
            // Payment verified successfully
            console.log('Payment verified successfully:', {
                order_id: razorpay_order_id,
                payment_id: razorpay_payment_id
            });

            // Here you can:
            // 1. Save payment details to database
            // 2. Send confirmation email
            // 3. Grant access to webinar
            
            res.json({ 
                success: true, 
                message: 'Payment verified successfully',
                order_id: razorpay_order_id,
                payment_id: razorpay_payment_id
            });
        } else {
            console.log('Payment verification failed');
            res.status(400).json({ 
                success: false, 
                message: 'Payment verification failed' 
            });
        }
    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Payment verification error',
            error: error.message 
        });
    }
});

// Success page endpoint
app.get('/success', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Payment Success - The Needles</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .success-container { max-width: 600px; margin: 0 auto; }
                .success-icon { font-size: 64px; color: #28a745; }
                h1 { color: #006478; }
                p { font-size: 18px; line-height: 1.6; }
                .btn { background: #006478; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; }
            </style>
        </head>
        <body>
            <div class="success-container">
                <div class="success-icon">✅</div>
                <h1>Payment Successful!</h1>
                <p>Thank you for registering for the Fashion Business Webinar!</p>
                <p>You will receive webinar details and Zoom link via email within 24 hours.</p>
                <p><strong>Webinar Date:</strong> 17th August 2025<br>
                <strong>Time:</strong> 10AM - 1PM (IST)</p>
                <a href="/" class="btn">Back to Home</a>
            </div>
        </body>
        </html>
    `);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('Razorpay integration ready!');
});