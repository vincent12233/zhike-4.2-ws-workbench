namespace Zhike.Desktop.Services;

public sealed record ReminderNotification(string CustomerId, string Title, string Detail, DateTimeOffset? DueAt, string Priority);

public sealed class NotificationService
{
    public event EventHandler<ReminderNotification>? ReminderRaised;

    public void Notify(ReminderNotification reminder)
    {
        ArgumentNullException.ThrowIfNull(reminder);
        ReminderRaised?.Invoke(this, reminder);
    }
}
