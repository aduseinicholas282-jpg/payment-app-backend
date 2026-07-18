require('dotenv').config();
const mongoose = require('mongoose');
const createApp = require('./app');

const app = createApp();
const PORT = process.env.PORT || 5000;

// Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/payment_db')
  .then(() => {
    console.log('MongoDB connected successfully');
    // Only start the cleanup cron once we have a working DB connection
    require('./jobs/expirePending').startExpirePendingJob();
  })
  .catch(err => console.error('MongoDB connection error:', err.message));

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
