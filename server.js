require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createTransport } = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Store OTPs temporarily (in production, use Redis or database)
const otpStore = new Map();

// Email transporter configuration
const emailTransporter = createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Use STARTTLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
});

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️  WARNING: EMAIL_USER or EMAIL_PASS not configured! OTP emails will not work.');
    console.warn('⚠️  Add these environment variables in Render dashboard.');
} else {
    console.log('✓ Email transporter initialized successfully');
    console.log('Email User:', process.env.EMAIL_USER);
    
    // Verify transporter configuration
    emailTransporter.verify(function(error, success) {
        if (error) {
            console.error('❌ Email transporter verification failed:', error.message);
        } else {
            console.log('✓ Email server is ready to send messages');
        }
    });
}

// Middleware
app.use(cors());
// For webhook endpoint, we need raw body to verify signature
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static('.')); // Serve static files from current directory

// Razorpay credentials from environment variables
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// Validate required environment variables
if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.error('ERROR: Missing required Razorpay credentials in .env file');
    process.exit(1);
}

// Validation helper functions
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validatePhone(phone) {
    // Remove all non-digit characters
    const cleanPhone = phone.replace(/\D/g, '');
    // Indian phone numbers: 10 digits (without country code) or 12 digits (with +91)
    return cleanPhone.length === 10 || (cleanPhone.length === 12 && cleanPhone.startsWith('91'));
}

// Generate 6-digit OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send Email OTP
async function sendEmailOTP(email, otp) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Email Verification - The Needles Webinar',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #006478;">Email Verification</h2>
                <p>Thank you for registering for the Fashion Business Webinar!</p>
                <p>Your verification code is:</p>
                <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                    <h1 style="color: #006478; font-size: 36px; letter-spacing: 5px; margin: 0;">${otp}</h1>
                </div>
                <p><strong>This code will expire in 10 minutes.</strong></p>
                <p>If you didn't request this code, please ignore this email.</p>
                <hr style="border: 1px solid #e9e9e9; margin: 30px 0;">
                <p style="color: #999; font-size: 12px; text-align: center;">
                    The Needles - Fashion Business Webinar<br>
                    December 10, 2025 | 9:00 AM - 12:00 PM IST
                </p>
            </div>
        `
    };

    return emailTransporter.sendMail(mailOptions);
}

// Send OTP endpoint
app.post('/send-otp', async (req, res) => {
    try {
        console.log('Send OTP request received:', req.body);
        const { email } = req.body;

        if (!validateEmail(email)) {
            console.log('Invalid email format:', email);
            return res.status(400).json({ 
                success: false,
                message: 'Invalid email address'
            });
        }

        const otp = generateOTP();
        console.log(`Generated OTP for ${email}: ${otp}`);
        
        // Store OTP with expiry (10 minutes)
        otpStore.set(email, {
            otp: otp,
            expiry: Date.now() + 10 * 60 * 1000,
            attempts: 0
        });

        console.log('Attempting to send email...');
        // Send email
        await sendEmailOTP(email, otp);
        console.log('Email sent successfully');

        console.log(`Email OTP sent to ${email}: ${otp}`); // For development/testing

        res.json({ 
            success: true,
            message: 'OTP sent to your email'
        });

    } catch (error) {
        console.error('Send OTP error:', error);
        
        // Check if it's a Gmail authentication error
        if (error.code === 'EAUTH' || error.responseCode === 535) {
            return res.status(500).json({ 
                success: false,
                message: 'Email service not configured. Please contact support.',
                error: 'Gmail credentials missing or invalid'
            });
        }
        
        res.status(500).json({ 
            success: false,
            message: 'Failed to send OTP. Please try again or contact support.',
            error: error.message 
        });
    }
});

// Verify OTP endpoint
app.post('/verify-otp', (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!otpStore.has(email)) {
            return res.status(400).json({ 
                success: false,
                message: 'OTP not found or expired. Please request a new one.'
            });
        }

        const stored = otpStore.get(email);

        // Check if expired
        if (Date.now() > stored.expiry) {
            otpStore.delete(email);
            return res.status(400).json({ 
                success: false,
                message: 'OTP expired. Please request a new one.'
            });
        }

        // Check attempts
        if (stored.attempts >= 3) {
            otpStore.delete(email);
            return res.status(400).json({ 
                success: false,
                message: 'Too many failed attempts. Please request a new OTP.'
            });
        }

        // Verify OTP
        if (stored.otp === otp) {
            otpStore.delete(email);
            res.json({ 
                success: true,
                message: 'Email verified successfully'
            });
        } else {
            stored.attempts += 1;
            otpStore.set(email, stored);
            res.status(400).json({ 
                success: false,
                message: `Invalid OTP. ${3 - stored.attempts} attempts remaining.`
            });
        }
    } catch (error) {
        console.error('Verify OTP error:', error);
        res.status(500).json({ 
            success: false,
            message: 'OTP verification failed',
            error: error.message 
        });
    }
});

// Email and phone validation endpoint
app.post('/validate-contact', (req, res) => {
    try {
        const { email, phone, whatsapp } = req.body;
        const errors = {};

        // Validate email
        if (!email || !validateEmail(email)) {
            errors.email = 'Please enter a valid email address';
        }

        // Validate phone
        if (!phone || !validatePhone(phone)) {
            errors.phone = 'Please enter a valid 10-digit phone number';
        }

        // Validate WhatsApp
        if (!whatsapp || !validatePhone(whatsapp)) {
            errors.whatsapp = 'Please enter a valid 10-digit WhatsApp number';
        }

        // Check if email or phone already registered (optional - requires database)
        // You can add duplicate check here if you implement database

        if (Object.keys(errors).length > 0) {
            return res.status(400).json({ 
                success: false,
                errors: errors
            });
        }

        res.json({ 
            success: true,
            message: 'Contact details validated successfully'
        });
    } catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Validation failed',
            error: error.message 
        });
    }
});

// Create order endpoint
app.post('/create-order', async (req, res) => {
    try {
        const { amount, currency, receipt, notes } = req.body;
        
        const orderData = {
            amount: amount || 100, // ₹1 in paise
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

// Webhook endpoint
app.post('/webhook', (req, res) => {
    try {
        const crypto = require('crypto');
        
        // Get the signature from headers
        const receivedSignature = req.headers['x-razorpay-signature'];
        
        // Get raw body (since we used express.raw middleware for this route)
        const webhookBody = req.body.toString();
        
        // Generate expected signature
        const expectedSignature = crypto
            .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
            .update(webhookBody)
            .digest('hex');
        
        // Verify signature
        if (receivedSignature !== expectedSignature) {
            console.log('Webhook signature verification failed');
            return res.status(400).json({ 
                error: 'Invalid signature' 
            });
        }
        
        // Parse the webhook payload
        const webhookData = JSON.parse(webhookBody);
        const event = webhookData.event;
        const payload = webhookData.payload;
        
        console.log('Webhook received:', event);
        console.log('Payload:', JSON.stringify(payload, null, 2));
        
        // Handle different webhook events
        switch(event) {
            case 'payment.authorized':
                console.log('Payment authorized:', payload.payment.entity.id);
                // Handle payment authorization
                // You might want to capture the payment or update your database
                break;
                
            case 'payment.captured':
                console.log('Payment captured:', payload.payment.entity.id);
                // Payment successful - grant access, send confirmation email, etc.
                handleSuccessfulPayment(payload.payment.entity);
                break;
                
            case 'payment.failed':
                console.log('Payment failed:', payload.payment.entity.id);
                // Handle failed payment - notify user, log, etc.
                handleFailedPayment(payload.payment.entity);
                break;
                
            case 'order.paid':
                console.log('Order paid:', payload.order.entity.id);
                // Order completely paid
                break;
                
            default:
                console.log('Unhandled webhook event:', event);
        }
        
        // Always respond with 200 to acknowledge receipt
        res.status(200).json({ received: true });
        
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ 
            error: 'Webhook processing failed',
            message: error.message 
        });
    }
});

// Helper function to handle successful payment
function handleSuccessfulPayment(paymentEntity) {
    console.log('Processing successful payment:', {
        payment_id: paymentEntity.id,
        order_id: paymentEntity.order_id,
        amount: paymentEntity.amount / 100, // Convert paise to rupees
        email: paymentEntity.email,
        contact: paymentEntity.contact,
        method: paymentEntity.method
    });
    
    // Here you can:
    // 1. Update database with payment status
    // 2. Send confirmation email to customer
    // 3. Grant access to webinar
    // 4. Send invoice
    // 5. Trigger any other post-payment workflows
}

// Helper function to handle failed payment
function handleFailedPayment(paymentEntity) {
    console.log('Processing failed payment:', {
        payment_id: paymentEntity.id,
        order_id: paymentEntity.order_id,
        error_code: paymentEntity.error_code,
        error_description: paymentEntity.error_description
    });
    
    // Here you can:
    // 1. Update database with failed status
    // 2. Send retry email to customer
    // 3. Log failure for analysis
}

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
                <p><strong>Webinar Date:</strong> 10th December 2025<br>
                <strong>Time:</strong> 9AM - 12PM (IST)</p>
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