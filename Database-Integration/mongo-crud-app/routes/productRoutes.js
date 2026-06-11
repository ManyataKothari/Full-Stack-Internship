// routes/productRoutes.js
const express = require('express');
const router = express.Router();
const {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');

// CREATE
router.post('/', createProduct);

// READ all
router.get('/', getAllProducts);

// READ one
router.get('/:id', getProductById);

// UPDATE
router.put('/:id', updateProduct);

// DELETE
router.delete('/:id', deleteProduct);

module.exports = router;
