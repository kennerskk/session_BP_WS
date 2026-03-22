import express from 'express';
import { Session } from '../models/session_schema.js';
import { Stat } from '../models/stat_schema.js';
import { v4 as uuidv4 } from 'uuid';
import { normalizeStatRecord } from '../utils/dataProcessor.js';

const router = express.Router();

/**
 * POST /save
 * Save a new telemetry session explicitly from the dashboard
 */
router.post('/save', async (req, res) => {
  try {
    const { name, data } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Session name is required' });
    }
    
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Data array is required' });
    }

    const session_id = uuidv4();
    const start_time = data.length > 0 && data[0].timestamp ? new Date(data[0].timestamp) : new Date();
    const end_time = data.length > 0 && data[data.length - 1].timestamp ? new Date(data[data.length - 1].timestamp) : new Date();

    // Create new session
    const newSession = await Session.create({
      session_id,
      name,
      status: 'stopped', // Default to stopped since it's already finished
      start_time,
      end_time,
      data_point_count: data.length,
      metadata: {}
    });

    // Bulk create stats
    const statBatch = data.map(item => {
      // If the frontend sent the `original` payload (from our localTelemetry normalization), use that to persist
      // Otherwise fallback to the item itself
      const rawPayload = item.original?.data ? item.original.data : item;
      return {
        session_id,
        session_name: name,
        data: rawPayload
      };
    });

    // Only bulk insert if there's data
    if (statBatch.length > 0) {
      await Stat.bulkCreate(statBatch);
    }

    res.json({
      session_id: newSession.session_id,
      name: newSession.name,
      status: newSession.status,
      data_point_count: newSession.data_point_count
    });

  } catch (err) {
    console.error('POST /api/session/save error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

/**
 * GET /list
 * List all sessions (paginated)
 */
router.get('/list', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status;

    const where = {};
    if (status) {
      where.status = status;
    }

    const sessions = await Session.findAll({
      where,
      order: [['start_time', 'DESC']],
      limit,
      offset,
      attributes: [
        'session_id',
        'name',
        'start_time',
        'end_time',
        'status',
        'data_point_count',
        'createdAt'
      ]
    });

    res.json(sessions);
  } catch (err) {
    console.error('GET /api/session/list error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

/**
 * GET /:session_id/data
 * Get data for specific session (paginated)
 */
router.get('/:session_id/data', async (req, res) => {
  try {
    const { session_id } = req.params;
    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;

    const normalize = req.query.normalized === 'true';

    const stats = await Stat.findAll({
      where: { session_id },
      order: [['createdAt', 'ASC']],
      limit,
      offset
    });

    res.json(normalize ? stats.map(s => normalizeStatRecord(s.toJSON())) : stats);
  } catch (err) {
    console.error('GET /api/session/:session_id/data error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

/**
 * DELETE /by-name/:session_name
 * Delete session and all associated data by its name
 */
router.delete('/by-name/:session_name', async (req, res) => {
  try {
    const { session_name } = req.params;

    // Delete all stats associated with this session
    const deletedStatsCount = await Stat.destroy({
      where: { session_name }
    });

    // Delete the session record
    const deletedSessionCount = await Session.destroy({
      where: { name: session_name }
    });

    if (deletedSessionCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      message: `Session ${session_name} and associated data deleted successfully`,
      deleted_stats_count: deletedStatsCount,
      deleted_session_count: deletedSessionCount
    });
  } catch (err) {
    console.error('DELETE /api/session/by-name/:session_name error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

export default router;
