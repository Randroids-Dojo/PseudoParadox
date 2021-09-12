using System;
using System.Collections.Generic;
using UnityEngine;

public class DoorTrigger : MonoBehaviour
{
    public Clock clock;
    public GameObject playerPrefab;
    public PlayerPositionManager playerPositionManager;

    TimeContainer time = new TimeContainer(7, 28, 0);

    private void OnTriggerEnter(Collider other)
    {
        if (other.tag == "Player")
        {
            Vector3 startingPosition = new Vector3(0, 0, 0);
            TravelToTime(time, other, startingPosition);

            DestroyPlayerClones();

            CreateNewPlayerClone(startingPosition);
        }
    }

    private void TravelToTime(TimeContainer time, Collider other, Vector3 startingPosition)
    {
        other.transform.position = startingPosition;
        playerPositionManager.SaveTimeTravel();
        clock.ChangeTime(time);
    }

    private void CreateNewPlayerClone(Vector3 startingPosition)
    {
        GameObject playerClone = Instantiate(playerPrefab, startingPosition, new Quaternion(0, 0, 0, 0));
        playerClone.GetComponent<VariantMovement>().instanceNumber = playerPositionManager.currentInstance;
        playerClone.GetComponent<VariantMovement>().clock = clock;
        playerClone.GetComponent<VariantMovement>().playerPositionManager = playerPositionManager;
    }

    private void DestroyPlayerClones()
    {
        GameObject[] playerClones = GameObject.FindGameObjectsWithTag("PlayerClone");

        foreach (GameObject playerClone in playerClones)
        {
            Destroy(playerClone.gameObject);
        }
    }
}
