import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false, collection: 'users' }));
  const users = await User.find({ email: /skatenant/i }).limit(5);
  console.log('Users found:', users.map(u => ({ email: u.email, role: u.role, isTenantAdmin: u.isTenantAdmin })));
  process.exit(0);
}).catch(console.error);
