require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
app.use(
  cors({
    origin: process.env.CLIENT_DOMAIN,
    credentials: true,
  })
);
app.use(express.json());

// JWT middleware
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("ticketbariDB");
    const ticketsCollection = db.collection("tickets");
    const usersCollection = db.collection("users");
    const bookingsCollection = db.collection("bookings");
    const paymentCollection = db.collection("payments");

    await bookingsCollection.createIndex(
      { ticketId: 1, seatNumber: 1 },
      {
        unique: true,
        partialFilterExpression: {
          bookingStatus: { $in: ["pending", "confirmed"] },
        },
      }
    );

    // Role middlewares
    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Admin only Actions!", role: user?.role });
      next();
    };

    const verifyVENDOR = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "vendor")
        return res
          .status(403)
          .send({ message: "Vendor only Actions!", role: user?.role });
      next();
    };

    // Helper functions
    function generateSeatNumber() {
      const row = Math.floor(Math.random() * 50) + 1;
      const seat = String.fromCharCode(65 + Math.floor(Math.random() * 6));
      return `${row}${seat}`;
    }

    function generateBookingReference() {
      return `BK${Date.now()}${Math.random()
        .toString(36)
        .substr(2, 6)
        .toUpperCase()}`;
    }

    function calculateArrivalTime(departureTime, durationHours = 4) {
      try {
        const [time, period] = departureTime.split(" ");
        const [hours, minutes] = time.split(":").map(Number);

        let hour24 = hours;
        if (period === "PM" && hours !== 12) hour24 += 12;
        if (period === "AM" && hours === 12) hour24 = 0;

        const totalMinutes = hour24 * 60 + minutes + durationHours * 60;
        const arrivalHour24 = Math.floor(totalMinutes / 60) % 24;
        const arrivalMinutes = totalMinutes % 60;

        const arrivalPeriod = arrivalHour24 >= 12 ? "PM" : "AM";
        const displayHour = arrivalHour24 % 12 || 12;

        return `${displayHour}:${String(arrivalMinutes).padStart(
          2,
          "0"
        )} ${arrivalPeriod}`;
      } catch {
        return "N/A";
      }
    }

    // User Routes
    app.post("/user", async (req, res) => {
      try {
        const userData = req.body;
        if (!userData?.email)
          return res.status(400).send({ message: "Email required" });

        userData.created_at = userData.created_at || new Date().toISOString();
        userData.last_loggedIn = new Date().toISOString();
        userData.role = userData.role || "customer";

        const query = { email: userData.email };
        const existingUser = await usersCollection.findOne(query);
        if (existingUser) {
          userData.role = existingUser.role;
        }

        const update = { $set: userData };
        const opts = { upsert: true };
        const result = await usersCollection.updateOne(query, update, opts);
        return res.send(result);
      } catch (error) {
        console.error("/user error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/user/role", verifyJWT, async (req, res) => {
      try {
        const result = await usersCollection.findOne({ email: req.tokenEmail });
        if (!result) return res.status(404).send({ message: "User not found" });
        res.send({ role: result?.role });
      } catch (error) {
        console.error("/user/role error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/user/profile", verifyJWT, async (req, res) => {
      try {
        const result = await usersCollection.findOne({ email: req.tokenEmail });
        if (!result) return res.status(404).send({ message: "User not found" });
        res.send(result);
      } catch (error) {
        console.error("/user/profile error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Configure multer
    const storage = multer.memoryStorage();
    const upload = multer({
      storage: storage,
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(
          path.extname(file.originalname).toLowerCase()
        );
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
          return cb(null, true);
        } else {
          cb(new Error("Only image files are allowed!"));
        }
      },
    });

    app.put(
      "/user/profile",
      verifyJWT,
      upload.single("image"),
      async (req, res) => {
        try {
          const email = req.tokenEmail;
          const { name, phone, location } = req.body;

          if (!name || name.trim().length < 2) {
            return res
              .status(400)
              .send({ message: "Name must be at least 2 characters" });
          }

          if (phone && !/^\+?[\d\s-()]+$/.test(phone)) {
            return res
              .status(400)
              .send({ message: "Invalid phone number format" });
          }

          const updateData = {
            name: name.trim(),
            phone: phone?.trim() || "",
            location: location?.trim() || "",
            updated_at: new Date().toISOString(),
          };

          if (req.file) {
            const base64Image = `data:${
              req.file.mimetype
            };base64,${req.file.buffer.toString("base64")}`;
            updateData.image = req.body.imageURL;
          }

          const result = await usersCollection.findOneAndUpdate(
            { email },
            { $set: updateData },
            { returnDocument: "after" }
          );

          if (!result) {
            return res.status(404).send({ message: "User not found" });
          }

          res.send(result);
        } catch (error) {
          console.error("/user/profile PUT error", error);
          if (error instanceof multer.MulterError) {
            if (error.code === "LIMIT_FILE_SIZE") {
              return res
                .status(400)
                .send({ message: "File size too large. Max 5MB allowed." });
            }
            return res.status(400).send({ message: error.message });
          }
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Create booking
    app.post("/bookings", verifyJWT, async (req, res) => {
      try {
        const { ticketId, quantity, seatNumber } = req.body;
        const email = req.tokenEmail;

        // Validate ticket ID
        if (!ObjectId.isValid(ticketId)) {
          return res.status(400).send({ message: "Invalid ticket ID" });
        }

        // Fetch ticket
        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(ticketId),
        });

        if (!ticket) {
          return res.status(404).send({ message: "Ticket not found" });
        }

        // Generate booking data
        const bookingReference = generateBookingReference();
        const generatedSeatNumber = seatNumber || generateSeatNumber();
        const arrivalTime =
          ticket.arrivalTime || calculateArrivalTime(ticket.departureTime);

        const ticketType = (
          ticket.transportType ||
          ticket.type ||
          "bus"
        ).toLowerCase();

        // Build booking object
        const booking = {
          // IDs
          ticketId: new ObjectId(ticketId),
          userEmail: email,

          // Quantity & pricing
          quantity,
          unitPrice: ticket.price,
          totalPrice: ticket.price * quantity,

          // Ticket details
          ticketTitle: ticket.title,
          ticketImage: ticket.image,
          ticketType,
          transportType: ticketType,

          // Route details
          from: ticket.from,
          to: ticket.to,
          departureDate: ticket.departureDate,
          departureTime: ticket.departureTime,
          arrivalTime,

          // Booking details
          seatNumber: generatedSeatNumber,
          bookingReference,

          // Status
          status: "pending",
          bookingStatus: "pending",

          // Payment (to be updated later)
          transactionId: null,
          paymentMethod: null,
          paymentDate: null,

          // Timestamps
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Insert booking
        const result = await bookingsCollection.insertOne(booking);
        res.status(201).send(result);
      } catch (error) {
        // Handle seat duplication (unique index)
        if (error.code === 11000) {
          return res.status(409).send({
            message: "Seat already booked. Please select another seat.",
          });
        }

        console.error("/bookings error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get user's bookings
    app.get("/user/bookings", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const bookings = await bookingsCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        const normalizedBookings = bookings.map((booking) => ({
          ...booking,
          bookingStatus: booking.bookingStatus || booking.status || "pending",
          ticketType: booking.ticketType || booking.transportType || "bus",
          seatNumber: booking.seatNumber || "N/A",
          bookingReference:
            booking.bookingReference ||
            booking._id.toString().substring(0, 10).toUpperCase(),
          arrivalTime: booking.arrivalTime || "N/A",
          price: booking.price || booking.totalPrice || booking.amount || 0,
        }));

        res.send(normalizedBookings);
      } catch (error) {
        console.error("/user/bookings error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Update booking status
    app.patch("/bookings/:id/status", verifyJWT, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid booking ID" });
        }

        const statusMap = {
          accepted: "confirmed",
          rejected: "cancelled",
          pending: "pending",
          paid: "confirmed",
          cancelled: "cancelled",
        };

        if (
          !["accepted", "rejected", "pending", "paid", "cancelled"].includes(
            status
          )
        ) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: status,
              bookingStatus: statusMap[status],
              updatedAt: new Date().toISOString(),
            },
          }
        );
        res.send(result);
      } catch (error) {
        console.error("/bookings/status error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Payment Intent
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      try {
        const { amount } = req.body;
        const amountInCents = Math.round(amount * 100);

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("/create-payment-intent error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Save payment and update booking
    app.post("/payments", verifyJWT, async (req, res) => {
      try {
        const { bookingId, transactionId, amount, paymentMethod } = req.body;
        const email = req.tokenEmail;

        if (!ObjectId.isValid(bookingId)) {
          return res.status(400).send({ message: "Invalid booking ID" });
        }

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
        });

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        // Prevent double payment
        if (booking.status === "paid") {
          return res.status(400).send({ message: "Booking already paid" });
        }

        /*
    const departureDateTime = new Date(
          `${booking.departureDate} ${booking.departureTime}`
        );
        if (departureDateTime < new Date()) {
          return res
            .status(400)
            .send({ message: "Cannot pay for past tickets" });
        }
    */

        // Validate amount
        if (amount !== booking.totalPrice) {
          return res.status(400).send({ message: "Payment amount mismatch" });
        }

        const paymentDate = new Date().toISOString();

        // Save payment history
        const payment = {
          userEmail: email,
          bookingId: new ObjectId(bookingId),
          transactionId,
          amount,
          ticketTitle: booking.ticketTitle,
          from: booking.from,
          to: booking.to,
          departureDate: booking.departureDate,
          departureTime: booking.departureTime,
          seatNumber: booking.seatNumber,
          bookingReference: booking.bookingReference,
          paymentMethod: paymentMethod || "Credit Card",
          paymentDate,
          status: "completed",
          createdAt: paymentDate,
        };

        await paymentCollection.insertOne(payment);

        // Update booking
        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          {
            $set: {
              status: "paid",
              bookingStatus: "confirmed",
              transactionId,
              paymentMethod: paymentMethod || "Credit Card",
              paymentDate,
              paidAt: paymentDate,
              updatedAt: paymentDate,
            },
          }
        );

        // Deduct ticket quantity
        await ticketsCollection.updateOne(
          { _id: booking.ticketId },
          { $inc: { quantity: -booking.quantity } }
        );

        res.send({ success: true });
      } catch (error) {
        console.error("/payments error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get user's transaction history
    app.get("/user/transactions", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const transactions = await paymentCollection
          .find({ userEmail: email })
          .sort({ paymentDate: -1 })
          .toArray();

        const normalizedTransactions = transactions.map((t) => ({
          _id: t._id,
          transactionId: t.transactionId,
          ticketTitle: t.ticketTitle || "Ticket Purchase",
          amount: t.amount || 0,
          paymentDate: t.paymentDate || t.createdAt,
          status: t.status || "completed",
          paymentMethod: t.paymentMethod || "N/A",
          bookingReference: t.bookingReference || "",
          from: t.from || "",
          to: t.to || "",
          departureDate: t.departureDate || "",
          seatNumber: t.seatNumber || "",
        }));

        res.send(normalizedTransactions);
      } catch (error) {
        console.error("/user/transactions error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Cancel/Delete booking
    app.delete("/bookings/:id", verifyJWT, async (req, res) => {
      try {
        const { id } = req.params;
        const email = req.tokenEmail;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid booking ID" });
        }

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        if (booking.userEmail !== email) {
          return res.status(403).send({ message: "Not authorized" });
        }

        // Update to cancelled status
        await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "cancelled",
              bookingStatus: "cancelled",
              cancelledAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }
        );

        // Restore ticket quantity if it was paid
        if (
          booking.status === "paid" ||
          booking.bookingStatus === "confirmed"
        ) {
          await ticketsCollection.updateOne(
            { _id: booking.ticketId },
            { $inc: { quantity: booking.quantity } }
          );
        }

        res.send({ success: true, message: "Booking cancelled successfully" });
      } catch (error) {
        console.error("/bookings DELETE error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Public Ticket Routes
    // Get all approved tickets
    app.get("/tickets/all", async (req, res) => {
      try {
        const tickets = await ticketsCollection
          .find({ verificationStatus: "approved", isHidden: { $ne: true } })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(tickets);
      } catch (error) {
        console.error("/tickets/all error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get latest tickets
    app.get("/tickets/latest", async (req, res) => {
      try {
        const tickets = await ticketsCollection
          .find({ verificationStatus: "approved", isHidden: { $ne: true } })
          .sort({ createdAt: -1 })
          .limit(8)
          .toArray();
        res.send(tickets);
      } catch (error) {
        console.error("/tickets/latest error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get advertised tickets
    app.get("/tickets/advertised-home", async (req, res) => {
      try {
        const docs = await ticketsCollection
          .find({
            isAdvertised: true,
            verificationStatus: "approved",
            isHidden: { $ne: true },
          })
          .limit(6)
          .toArray();
        res.send(docs);
      } catch (error) {
        console.error("/tickets/advertised-home error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get single ticket by id
    app.get("/tickets/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ticket ID" });
        }
        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!ticket) {
          return res.status(400).send({ message: "Ticket not found" });
        }
        res.send(ticket);
      } catch (error) {
        console.error("/tickets/:id error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Vendor Routes
    // Add ticket(vendor)
    app.post("/tickets", verifyJWT, verifyVENDOR, async (req, res) => {
      try {
        const ticketData = req.body;
        ticketData.vendorEmail = req.tokenEmail;
        ticketData.verificationStatus = "pending";
        ticketData.isAdvertised = false;
        ticketData.createdAt = new Date().toISOString();

        const result = await ticketsCollection.insertOne(ticketData);
        res.send(result);
      } catch (error) {
        console.error("/tickets error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get vendor's tickets
    app.get("/vendor/tickets", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const tickets = await ticketsCollection
          .find({ vendorEmail: email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(tickets);
      } catch (error) {
        console.error("/vendor/tickets error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Update ticket (vendor)
    app.patch("/tickets/:id", verifyJWT, verifyVENDOR, async (req, res) => {
      try {
        const { id } = req.params;
        const ticketData = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ticket ID" });
        }

        // Verify ownership
        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!ticket)
          return res.status(404).send({ message: "Ticket not found" });
        if (ticket.vendorEmail !== req.tokenEmail) {
          return res.status(403).send({ message: "Not authorized" });
        }
        delete ticketData._id;
        const result = await ticketsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: ticketData }
        );
        res.send(result);
      } catch (error) {
        console.error("/tickets/:id error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    //  Delete ticket (vendor)
    app.delete("/tickets/:id", verifyJWT, verifyVENDOR, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ticket ID" });
        }

        // Verify ownership
        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!ticket)
          return res.status(404).send({ message: "Ticket not found" });
        if (ticket.vendorEmail !== req.tokenEmail) {
          return res.status(403).send({ message: "Not authorized" });
        }
        const result = await ticketsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.error("/tickets/:id error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get bookings for vendor's tickets
    app.get("/vendor/bookings", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;

        // Get all vendor's ticket IDs
        const vendorTickets = await ticketsCollection
          .find({ vendorEmail: email })
          .project({ _id: 1 })
          .toArray();

        const ticketIds = vendorTickets.map((t) => t._id);

        // Get all bookings for these tickets
        const bookings = await bookingsCollection
          .find({ ticketId: { $in: ticketIds } })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(bookings);
      } catch (error) {
        console.error("/vendor/bookings error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get vendor revenue stats
    app.get("/vendor/revenue", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;

        // Get vendor's tickets
        const vendorTickets = await ticketsCollection
          .find({ vendorEmail: email })
          .toArray();

        const ticketIds = vendorTickets.map((t) => t._id);

        // Get paid bookings
        // const paidBookings = await bookingsCollection
        //   .find({ ticketId: { $in: ticketIds }, status: "paid" })
        //   .toArray();
        const paidBookings = await bookingsCollection
          .find({
            ticketId: { $in: ticketIds },
            $or: [{ status: "paid" }, { bookingStatus: "confirmed" }],
          })
          .toArray();

        const totalRevenue = paidBookings.reduce(
          (sum, b) => sum + (b.totalPrice || b.amount || 0),
          0
        );

        const totalTicketsSold = paidBookings.reduce(
          (sum, b) => sum + b.quantity,
          0
        );
        const totalTicketsAdded = vendorTickets.length;

        res.send({ totalRevenue, totalTicketsSold, totalTicketsAdded });
      } catch (error) {
        console.error("/vendor/revenue error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Admin Routes
    // Get all tickets for admin
    app.get("/admin/tickets", verifyJWT, verifyADMIN, async (req, res) => {
      try {
        const result = await ticketsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        console.error("/admin/tickets error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Approve/Reject ticket (admin)
    app.patch(
      "/admin/tickets/:id/verify",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { verificationStatus } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid ticket ID" });
          }
          if (!["approved", "rejected"].includes(verificationStatus)) {
            return res.status(400).send({ message: "Invalid stats" });
          }

          const result = await ticketsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { verificationStatus } }
          );
          res.send(result);
        } catch (error) {
          console.error("/admin/tickets/verify error", error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Get all users (admin)
    app.get("/admin/users", verifyJWT, verifyADMIN, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        console.error("/admin/users error", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Update user role (admin)
    app.patch(
      "/admin/users/:email/role",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
        try {
          const { email } = req.params;
          const { role } = req.body;

          if (!["customer", "vendor", "admin"].includes(role)) {
            return res.status(400).send({ message: "Invalid role" });
          }

          const result = await usersCollection.updateOne(
            { email },
            { $set: { role } }
          );
          res.send(result);
        } catch (error) {
          console.error("/admin/users/role error", error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Mark vendor as fraud(admin)
    app.patch(
      "/admin/users/:email/fraud",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
        try {
          const { email } = req.params;

          // Mark user as fraud
          await usersCollection.updateOne(
            { email },
            { $set: { isFraud: true } }
          );
          // Hide all vendor's tickets
          await ticketsCollection.updateMany(
            { vendorEmail: email },
            { $set: { isHidden: true } }
          );

          res.send({ success: true });
        } catch (error) {
          console.error("/admin/users/fraud error", error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Admin: toggle advertise, enforce max 6 advertised
    app.patch(
      "/admin/tickets/advertise/:id",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid id" });
        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!ticket)
          return res.status(404).send({ message: "Ticket not found" });
        if (ticket.verificationStatus !== "approved")
          return res
            .status(400)
            .send({ message: "Only approved tickets can be advertised" });
        if (!ticket.isAdvertised) {
          const count = await ticketsCollection.countDocuments({
            isAdvertised: true,
            verificationStatus: "approved",
          });
          if (count >= 6)
            return res.status(400).send({ message: "Max 6 advertised" });
        }
        await ticketsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isAdvertised: !ticket.isAdvertised } }
        );
        res.send({
          message: "Toggled advertise",
          isAdvertised: !ticket.isAdvertised,
        });
      }
    );

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
