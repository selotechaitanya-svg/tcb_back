'use strict';

const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema(
  {
    previous_status: {
      type: String,
      default: null
    },
    new_status: {
      type: String,
      required: true,
      enum: ['Reported', 'Claimed', 'In Progress', 'Resolved']
    },
    changed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    changed_by_name: {
      type: String,
      default: ''
    },
    changed_at: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      default: ''
    }
  },
  { _id: true }
);

const incidentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Incident title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters']
    },
    description: {
      type: String,
      required: [true, 'Incident description is required'],
      trim: true,
      maxlength: [3000, 'Description cannot exceed 3000 characters']
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      maxlength: [50, 'Category cannot exceed 50 characters']
    },
    severity: {
      type: Number,
      required: [true, 'Severity is required (1-5)'],
      min: [1, 'Severity must be at least 1'],
      max: [5, 'Severity cannot exceed 5']
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
      maxlength: [200, 'Location cannot exceed 200 characters']
    },
    status: {
      type: String,
      required: true,
      enum: ['Reported', 'Claimed', 'In Progress', 'Resolved'],
      default: 'Reported',
      index: true
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    reporterName: {
      type: String,
      default: ''
    },
    hero: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    heroName: {
      type: String,
      default: null
    },
    statusHistory: [statusHistorySchema]
  },
  { timestamps: true }
);

incidentSchema.index({ status: 1, severity: -1, createdAt: -1 });

module.exports = mongoose.model('Incident', incidentSchema);

