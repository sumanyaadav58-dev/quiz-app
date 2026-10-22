const mongoose = require("mongoose");

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing. Copy .env.example to .env and set it.");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    console.log("MongoDB Connected");
  } catch (error) {
    console.error("=================================");
    console.error("Could not connect to MongoDB:", error.message);
    console.error("Check that MongoDB is running and MONGO_URI in .env is correct.");
    console.error("=================================");
    process.exit(1);
  }

  mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected"));
  mongoose.connection.on("reconnected", () => console.log("MongoDB reconnected"));
};

module.exports = connectDB;
