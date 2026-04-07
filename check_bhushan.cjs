const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load env from current directory
dotenv.config({ path: path.join(__dirname, '.env') });

async function checkStudent() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.');

    const Student = require('./models/Student');
    const StudentAuth = require('./models/StudentAuth');

    const email = 'bhushan.poojary2006@gmail.com';
    const normalizedEmail = email.toLowerCase().trim();

    console.log(`\n--- Status for ${normalizedEmail} ---`);

    const studentRecord = await Student.findOne({
      email: { $regex: new RegExp("^" + normalizedEmail + "$", "i") }
    });

    if (studentRecord) {
      console.log('✅ Found in Student collection (Teacher records):');
      console.log(JSON.stringify(studentRecord, null, 2));
    } else {
      console.log('❌ NOT found in Student collection.');
    }

    const studentAuth = await StudentAuth.findOne({ email: normalizedEmail });

    if (studentAuth) {
      console.log('\n✅ Found in StudentAuth collection:');
      console.log(JSON.stringify({
        email: studentAuth.email,
        name: studentAuth.name,
        usn: studentAuth.usn,
        isVerified: studentAuth.isVerified,
        hasPassword: !!studentAuth.password
      }, null, 2));
    } else {
      console.log('\n❌ NOT found in StudentAuth collection.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkStudent();
