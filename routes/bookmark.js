const express = require('express');
const Bookmark = require('../models/Bookmark');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Get all bookmarks
router.get('/', protect, async (req, res) => {
  try {
    const bookmarks = await Bookmark.find({ userId: req.user._id })
      .populate('folderId')
      .sort('-createdAt');
    res.json({ success: true, bookmarks });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Create bookmark
router.post('/', express.json({ limit: '50mb' }), protect, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const data = { ...req.body };
    if (!data.folderId || !mongoose.Types.ObjectId.isValid(data.folderId)) {
      delete data.folderId;
    }
    const bookmark = await Bookmark.create({
      ...data,
      userId: req.user._id
    });
    res.status(201).json({ success: true, bookmark });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update bookmark
router.put('/:id', express.json({ limit: '50mb' }), protect, async (req, res) => {
  try {
    const bookmark = await Bookmark.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: req.body },
      { new: true }
    );
    if (!bookmark) {
      return res.status(404).json({ success: false, message: 'Bookmark not found' });
    }
    res.json({ success: true, message: 'Bookmark updated successfully', bookmark });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Delete bookmark
router.delete('/:id', protect, async (req, res) => {
  try {
    const bookmark = await Bookmark.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });
    if (!bookmark) {
      return res.status(404).json({ message: 'Bookmark not found' });
    }
    res.json({ success: true, message: 'Bookmark deleted' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
