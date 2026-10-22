require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const ADMIN_EMAIL = "bhagyansharma07@gmail.com";
const NEW_PASSWORD = "Admin@123";

async function resetAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected");

    const hashedPassword = await bcrypt.hash(NEW_PASSWORD, 10);

    const result = await User.updateOne(
      { email: ADMIN_EMAIL },
      {
        $set: {
          password: hashedPassword,
          role: "admin"
        }
      }
    );

    if (result.matchedCount === 0) {
      console.log("Admin user not found.");
    } else {
      console.log("--------------------------------");
      console.log("ADMIN PASSWORD RESET SUCCESSFUL");
      console.log("--------------------------------");
      console.log("Email: " + ADMIN_EMAIL);
      console.log("Password: " + NEW_PASSWORD);
      console.log("Role: admin");
      console.log("--------------------------------");
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error.message);
  }
}

resetAdmin();