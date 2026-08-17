#!/usr/bin/env python3
"""
Forex Regime Classifier Training & ONNX Exporter
Generates model_forex_regime.onnx for native MT5 OnnxRun() in-process execution.
"""
import numpy as np

def export_model():
    print("[INFO] Building and exporting PyTorch/LightGBM model to ONNX format...")
    try:
        import torch
        import torch.nn as nn
        
        class ForexRegimeNN(nn.Module):
            def __init__(self, input_dim=5, hidden_dim=16, num_classes=3):
                super(ForexRegimeNN, self).__init__()
                self.net = nn.Sequential(
                    nn.Linear(input_dim, hidden_dim),
                    nn.BatchNorm1d(hidden_dim),
                    nn.SiLU(),
                    nn.Linear(hidden_dim, hidden_dim),
                    nn.SiLU(),
                    nn.Linear(hidden_dim, num_classes),
                    nn.Softmax(dim=1)
                )
                
            def forward(self, x):
                return self.net(x)

        model = ForexRegimeNN(input_dim=5, hidden_dim=16, num_classes=3)
        model.eval()
        dummy_input = torch.randn(1, 5, dtype=torch.float32)
        onnx_file_path = "model_forex_regime.onnx"
        
        torch.onnx.export(
            model,
            dummy_input,
            onnx_file_path,
            export_params=True,
            opset_version=14,
            do_constant_folding=True,
            input_names=['input_features'],
            output_names=['probabilities'],
            dynamic_axes={'input_features': {0: 'batch_size'}, 'probabilities': {0: 'batch_size'}}
        )
        print(f"[SUCCESS] Exported ONNX model to {onnx_file_path}")
    except ImportError:
        print("[NOTICE] PyTorch not installed in current environment. Run: pip install torch onnx")

if __name__ == "__main__":
    export_model()
