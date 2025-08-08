class LcStudyError(Exception):
    pass


class SessionError(LcStudyError):
    pass


class SessionNotFoundError(SessionError):
    pass


class SessionExpiredError(SessionError):
    pass


class InvalidSessionStateError(SessionError):
    pass


class EngineError(LcStudyError):
    pass


class EngineNotFoundError(EngineError):
    pass


class EngineInitializationError(EngineError):
    pass


class EngineAnalysisError(EngineError):
    pass


class EngineTimeoutError(EngineError):
    pass


class GameError(LcStudyError):
    pass


class IllegalMoveError(GameError):
    pass


class GameFinishedError(GameError):
    pass


class InvalidMoveFormatError(GameError):
    pass


class AnalysisError(LcStudyError):
    pass


class AnalysisNotAvailableError(AnalysisError):
    pass


class AnalysisInterruptedError(AnalysisError):
    pass


class ConfigurationError(LcStudyError):
    pass


class InvalidConfigurationError(ConfigurationError):
    pass


class MissingConfigurationError(ConfigurationError):
    pass


class DataError(LcStudyError):
    pass


class SerializationError(DataError):
    pass


class ValidationError(DataError):
    pass


class NetworkError(LcStudyError):
    pass


class NetworkDownloadError(NetworkError):
    pass
