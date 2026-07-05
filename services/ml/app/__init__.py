"""Tarragon Health ML microservice.

Stateless FastAPI service. No database access, no file writes: all patient
data arrives in the request body and results are returned as JSON. See
docs/ARCHITECTURE.md §4 and §9 for the service contract.
"""

__version__ = "0.1.0"
