from dataclasses import dataclass


@dataclass
class ServiceResult:
    success: bool
    message: str = ''
    data: dict | None = None


class PortfolioItemService:
    @staticmethod
    def create(*args, **kwargs):
        return ServiceResult(success=False, message='Not implemented', data={})
