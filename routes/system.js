const express = require('express');
const router = express.Router();

// Hardcoded for now, but you can move this to .env or a Database
const APP_VERSION = {
    version: '2.0.2', // Update this number when you want to trigger an update
    url: 'https://faculty-quest.vercel.app/update.zip', // URL to the zipped dist folder
    mandatory: false,
    releaseNotes: 'New security features and password reset system.'
};

// Check for updates
router.get('/check', (req, res) => {
    res.json(APP_VERSION);
});

module.exports = router;
