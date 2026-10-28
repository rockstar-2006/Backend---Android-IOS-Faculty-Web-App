const User = require('../models/User');

const seedAdminUser = async () => {
  try {
    const adminEmail = 'admin@gmail.com';
    let admin = await User.findOne({ email: adminEmail }).select('+password');

    if (!admin) {
      console.log('👑 Creating Super Admin account (admin@gmail.com)...');
      admin = await User.create({
        name: 'Super Administrator',
        email: adminEmail,
        password: 'admin@123',
        role: 'admin'
      });
      console.log('✅ Super Admin created successfully (admin@gmail.com / admin@123)');
    } else {
      // Ensure role is admin and password is admin@123
      let modified = false;
      if (admin.role !== 'admin') {
        admin.role = 'admin';
        modified = true;
      }
      const isMatch = await admin.comparePassword('admin@123');
      if (!isMatch) {
        admin.password = 'admin@123';
        modified = true;
      }
      if (modified) {
        await admin.save();
        console.log('✅ Super Admin credentials synchronized (admin@gmail.com / admin@123)');
      }
    }
  } catch (err) {
    console.error('Super Admin seed error:', err.message);
  }
};

module.exports = { seedAdminUser };
